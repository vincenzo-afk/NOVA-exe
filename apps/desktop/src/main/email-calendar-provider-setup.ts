import { join } from "node:path";
import { safeStorage } from "electron";
import type { StructuredLogger } from "@nova/shared";
import {
  CalendarAssistant,
  EmailAssistant,
  GmailProvider,
  GoogleCalendarProvider,
  GoogleOAuthClient,
  GoogleTokenManager,
  type BriefingItem,
  type BriefingSource,
  type EmailMessage,
  type StoredGoogleTokens,
} from "@nova/runtime";

import { ElectronSafeStorageVaultBackend } from "./vault-backend.js";
import { runGoogleConsentFlow, GoogleConsentCancelledError } from "./google-oauth-flow.js";

/**
 * Wires a real Google account into NOVA's `EmailAssistant`/
 * `CalendarAssistant` — previously both classes existed only with test
 * doubles standing in for `EmailProvider`/`CalendarProvider` anywhere in
 * the repository, and `main.ts` never constructed either assistant at
 * all, so `readEmail`/`sendEmail`/`upcomingCalendarEvents`/
 * `createCalendarEvent` always failed with "not configured for this
 * runtime" in the desktop build regardless of what the user did in
 * Settings. This module is the desktop-specific counterpart to
 * llm-provider-setup.ts: it owns credential storage and interactive
 * consent (Electron-specific), and hands `RuntimeApplication` the
 * finished, provider-agnostic assistants.
 *
 * `NOVA_GOOGLE_OAUTH_CLIENT_ID` must be set to a Google Cloud OAuth
 * client ID configured as a "Desktop app" type — this is a public
 * identifier (not a secret; see google-oauth.ts's PKCE comment) that
 * distinguishes NOVA's own consent requests from any other application's.
 * Without it, sign-in is unavailable and the assistants stay unconfigured
 * (the safe default the rest of RuntimeApplication already treats
 * "assistant not passed" as: a "configure to enable" state, not a crash).
 */

const GOOGLE_TOKENS_VAULT_REFERENCE = "vault://google-workspace-tokens";

export interface EmailCalendarProviderSetup {
  readonly emailAssistant: EmailAssistant | undefined;
  readonly calendarAssistant: CalendarAssistant | undefined;
  readonly briefingSources: readonly BriefingSource[];
  readonly isGoogleAccountConnected: () => boolean;
  readonly connectGoogleAccount: () => Promise<{ readonly connected: true }>;
  readonly disconnectGoogleAccount: () => void;
}

export function setupEmailCalendarProviders(options: {
  readonly userDataPath: string;
  readonly logger?: StructuredLogger;
}): EmailCalendarProviderSetup {
  const vault = new ElectronSafeStorageVaultBackend({
    filePath: join(options.userDataPath, "secrets", "google-vault.json"),
    safeStorage,
  });
  const clientId = process.env.NOVA_GOOGLE_OAUTH_CLIENT_ID;

  const loadTokens = (): StoredGoogleTokens | undefined => {
    const raw = vault.get(GOOGLE_TOKENS_VAULT_REFERENCE);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as StoredGoogleTokens;
    } catch {
      options.logger?.warning("email_calendar_setup.token_parse_failed", {});
      return undefined;
    }
  };
  const saveTokens = (tokens: StoredGoogleTokens): void => {
    vault.put(GOOGLE_TOKENS_VAULT_REFERENCE, JSON.stringify(tokens));
  };

  if (!clientId) {
    options.logger?.info("email_calendar_setup.no_client_id_configured", {
      hint: "Set NOVA_GOOGLE_OAUTH_CLIENT_ID to enable email and calendar sign-in.",
    });
    return {
      emailAssistant: undefined,
      calendarAssistant: undefined,
      briefingSources: [],
      isGoogleAccountConnected: () => false,
      connectGoogleAccount: () => {
        throw new Error(
          "Google sign-in is not configured for this build (missing NOVA_GOOGLE_OAUTH_CLIENT_ID).",
        );
      },
      disconnectGoogleAccount: () => {
        /* Nothing was ever connected. */
      },
    };
  }

  const client = new GoogleOAuthClient({ clientId, redirectUri: "http://127.0.0.1/callback" });
  const tokenSource = new GoogleTokenManager({ client, loadTokens, saveTokens });

  const emailProvider = new GmailProvider({ tokenSource });
  const calendarProvider = new GoogleCalendarProvider({ tokenSource });
  const emailAssistant = new EmailAssistant(emailProvider, { logger: options.logger });
  const calendarAssistant = new CalendarAssistant([calendarProvider], { logger: options.logger });

  const emailBriefingSource: BriefingSource = {
    source_id: "email.google",
    collect: async (): Promise<readonly BriefingItem[]> => {
      if (!loadTokens()) return [];
      // Uses the provider's header-only path directly rather than
      // `emailAssistant.read({})`: the briefing only ever shows
      // sender/subject for 5 items, so there is no reason to pay for
      // fetching and decoding 25 full message bodies (including
      // attachments metadata) on every notification cycle just to
      // throw away everything but the top 5 headers.
      let headers: readonly EmailMessage[];
      try {
        headers = await emailProvider.readHeadersOnly({}, 5);
      } catch {
        options.logger?.warning("email_calendar_setup.briefing_email_fetch_failed", {});
        return [];
      }
      return headers.map((message) => ({
        title: `Email from ${message.sender || "unknown sender"}`,
        summary: message.subject || "(no subject)",
        source_id: "email.google",
        requires_confirmation: false,
      }));
    },
  };

  const calendarBriefingSource: BriefingSource = {
    source_id: "calendar.google",
    collect: async (): Promise<readonly BriefingItem[]> => {
      if (!loadTokens()) return [];
      const upcoming = await calendarAssistant.upcoming();
      if (!upcoming.ok) return [];
      const startOfTomorrowMs = new Date(new Date().setHours(24, 0, 0, 0)).getTime();
      const items: BriefingItem[] = [];
      // A single `for...of` with early `break` instead of
      // `.filter().map()`: `upcoming()` already returns events in
      // start-time order (Calendar API's `orderBy=startTime`), so once
      // one event falls on or after tomorrow, every event after it in
      // the array does too — `.filter()` would still walk and allocate
      // an intermediate array across the entire 90-day result set
      // before `.map()` even starts, for a window that's typically a
      // handful of items long.
      for (const event of upcoming.value) {
        if (event.start >= startOfTomorrowMs) break;
        items.push({
          title: event.title,
          summary: `${new Date(event.start).toLocaleTimeString()} with ${event.attendees.length} attendee(s)`,
          source_id: "calendar.google",
          requires_confirmation: false,
        });
      }
      return items;
    },
  };

  return {
    emailAssistant,
    calendarAssistant,
    briefingSources: [emailBriefingSource, calendarBriefingSource],
    isGoogleAccountConnected: () => loadTokens() !== undefined,
    connectGoogleAccount: async () => {
      try {
        const result = await runGoogleConsentFlow({ clientId });
        saveTokens(result.tokens);
        options.logger?.info("email_calendar_setup.google_account_connected", {});
        return { connected: true };
      } catch (cause) {
        if (cause instanceof GoogleConsentCancelledError) {
          options.logger?.info("email_calendar_setup.google_consent_cancelled", {});
        } else {
          options.logger?.warning("email_calendar_setup.google_consent_failed", {
            error: cause instanceof Error ? cause.message : String(cause),
          });
        }
        throw cause;
      }
    },
    disconnectGoogleAccount: () => {
      vault.delete(GOOGLE_TOKENS_VAULT_REFERENCE);
      options.logger?.info("email_calendar_setup.google_account_disconnected", {});
    },
  };
}

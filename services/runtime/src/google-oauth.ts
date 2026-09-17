import { createHash, randomBytes } from "node:crypto";

import type { GoogleAccessTokenSource } from "./google-workspace-provider.js";

/**
 * Google OAuth2 Authorization Code + PKCE flow, transport-only. PKCE is
 * used instead of a client secret because a desktop app cannot keep a
 * secret confidential (it ships inside the installed binary) — PKCE is
 * Google's documented flow for exactly this "installed application"
 * case, so no client secret is required or stored anywhere in this file.
 *
 * This module never opens a window or drives any UI: `buildAuthorizationUrl`
 * returns a URL the caller (apps/desktop) opens in a BrowserWindow, and
 * `exchangeCodeForTokens` takes whatever authorization code that window's
 * redirect callback captured. Keeping the split this way means this file
 * has zero Electron dependency and is unit-testable with a fake fetcher,
 * matching every other provider in this package (see groq-provider.ts).
 */

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export const GOOGLE_GMAIL_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
] as const;

export interface PkcePair {
  readonly verifier: string;
  readonly challenge: string;
}

/** Generates a fresh PKCE verifier/challenge pair (RFC 7636, S256 method). */
export function generatePkcePair(): PkcePair {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export interface GoogleOAuthClientOptions {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly fetcher?: typeof fetch;
  readonly tokenEndpoint?: string;
  readonly authEndpoint?: string;
  readonly scopes?: readonly string[];
}

export interface StoredGoogleTokens {
  readonly access_token: string;
  readonly refresh_token: string;
  /** Epoch milliseconds after which `access_token` must be refreshed before use. */
  readonly expires_at: number;
}

interface GoogleTokenResponse {
  readonly access_token: string;
  readonly refresh_token?: string;
  readonly expires_in: number;
  readonly error?: string;
  readonly error_description?: string;
}

export class GoogleOAuthClient {
  private readonly fetcher: typeof fetch;
  private readonly tokenEndpoint: string;
  private readonly authEndpoint: string;
  private readonly scopes: readonly string[];

  public constructor(private readonly options: GoogleOAuthClientOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.tokenEndpoint = options.tokenEndpoint ?? GOOGLE_TOKEN_ENDPOINT;
    this.authEndpoint = options.authEndpoint ?? GOOGLE_AUTH_ENDPOINT;
    this.scopes = options.scopes ?? GOOGLE_GMAIL_CALENDAR_SCOPES;
  }

  public buildAuthorizationUrl(pkce: PkcePair, state: string): string {
    const url = new URL(this.authEndpoint);
    url.searchParams.set("client_id", this.options.clientId);
    url.searchParams.set("redirect_uri", this.options.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", this.scopes.join(" "));
    url.searchParams.set("access_type", "offline");
    // Forces the consent screen even for a user who previously granted
    // access, which is required to guarantee Google issues a refresh
    // token on this pass — Google only issues one on a user's *first*
    // consent unless prompt=consent forces it again.
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("code_challenge", pkce.challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", state);
    return url.toString();
  }

  public async exchangeCodeForTokens(
    authorizationCode: string,
    verifier: string,
  ): Promise<StoredGoogleTokens> {
    const response = await this.fetcher(this.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.options.clientId,
        redirect_uri: this.options.redirectUri,
        grant_type: "authorization_code",
        code: authorizationCode,
        code_verifier: verifier,
      }),
    });
    const body = (await response.json()) as GoogleTokenResponse;
    if (!response.ok || !body.refresh_token) {
      throw new Error(
        `Google token exchange failed: ${body.error_description ?? body.error ?? response.statusText}.`,
      );
    }
    return {
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      expires_at: Date.now() + body.expires_in * 1000,
    };
  }

  public async refreshAccessToken(refreshToken: string): Promise<StoredGoogleTokens> {
    const response = await this.fetcher(this.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.options.clientId,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
    const body = (await response.json()) as GoogleTokenResponse;
    if (!response.ok) {
      throw new Error(
        `Google token refresh failed: ${body.error_description ?? body.error ?? response.statusText}.`,
      );
    }
    return {
      access_token: body.access_token,
      // Google's refresh grant does not reissue a refresh token; the
      // original one remains valid and must be carried forward.
      refresh_token: body.refresh_token ?? refreshToken,
      expires_at: Date.now() + body.expires_in * 1000,
    };
  }
}

export interface GoogleTokenManagerOptions {
  readonly client: GoogleOAuthClient;
  readonly loadTokens: () => StoredGoogleTokens | undefined;
  readonly saveTokens: (tokens: StoredGoogleTokens) => void;
  /** Refresh this many milliseconds before actual expiry, to absorb clock skew and request latency. */
  readonly refreshSkewMs?: number;
}

/**
 * Implements `GoogleAccessTokenSource` by transparently refreshing an
 * expired access token via the stored refresh token, persisting the
 * result through the caller-supplied `saveTokens` (in practice, the
 * desktop vault). This is the single seam `GmailProvider` and
 * `GoogleCalendarProvider` depend on — they never see a refresh token or
 * know a refresh happened.
 */
export class GoogleTokenManager implements GoogleAccessTokenSource {
  private readonly refreshSkewMs: number;

  public constructor(private readonly options: GoogleTokenManagerOptions) {
    this.refreshSkewMs = options.refreshSkewMs ?? 60_000;
  }

  public async getAccessToken(): Promise<string> {
    const stored = this.options.loadTokens();
    if (!stored) {
      throw new Error("No Google account is connected. Complete sign-in before using this feature.");
    }
    if (Date.now() < stored.expires_at - this.refreshSkewMs) {
      return stored.access_token;
    }
    const refreshed = await this.options.client.refreshAccessToken(stored.refresh_token);
    this.options.saveTokens(refreshed);
    return refreshed.access_token;
  }
}

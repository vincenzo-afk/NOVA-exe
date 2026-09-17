import type { CalendarDraft, CalendarEvent, CalendarProvider } from "./calendar-assistant.js";
import type {
  EmailDraft,
  EmailMessage,
  EmailQuery,
  EmailProvider,
  EmailSendReceipt,
} from "./email-assistant.js";

/**
 * Real, network-calling `EmailProvider`/`CalendarProvider` implementations
 * against the Gmail and Google Calendar REST APIs. Before this file, both
 * interfaces existed only as contracts — every implementation anywhere in
 * the repository (including runtime-application.ts's own tests) was a test
 * double, and `main.ts` never constructed `EmailAssistant`/`CalendarAssistant`
 * at all, so `readEmail`/`sendEmail`/`upcomingCalendarEvents`/etc. always
 * failed with "not configured for this runtime" in the desktop build.
 *
 * OAuth token acquisition (the interactive consent flow) is deliberately
 * kept out of this file — it's Electron-specific (needs a BrowserWindow)
 * and belongs in apps/desktop, matching how llm-provider-setup.ts keeps
 * AnthropicProvider itself transport-only and puts credential *acquisition*
 * in the desktop layer. This file only consumes an already-valid access
 * token via `getAccessToken`, and refreshes are the caller's problem
 * (see google-oauth.ts's `GoogleTokenManager`, which implements exactly
 * that contract).
 */

export interface GoogleAccessTokenSource {
  /** Returns a currently-valid access token, refreshing first if the caller's stored token has expired. */
  readonly getAccessToken: () => Promise<string>;
}

export interface GoogleProviderOptions {
  readonly tokenSource: GoogleAccessTokenSource;
  readonly fetcher?: typeof fetch;
  readonly gmailEndpoint?: string;
  readonly calendarEndpoint?: string;
  /** Which calendar to read/write; Google's alias for the signed-in user's own calendar. */
  readonly calendarId?: string;
}

const DEFAULT_GMAIL_ENDPOINT = "https://gmail.googleapis.com/gmail/v1";
const DEFAULT_CALENDAR_ENDPOINT = "https://www.googleapis.com/calendar/v3";
const DEFAULT_CALENDAR_ID = "primary";

interface GmailListMessagesResponse {
  readonly messages?: readonly { readonly id: string }[];
}

interface GmailMessageHeader {
  readonly name: string;
  readonly value: string;
}

interface GmailMessagePart {
  readonly mimeType?: string;
  readonly body?: { readonly data?: string };
  readonly parts?: readonly GmailMessagePart[];
}

interface GmailMessageResource {
  readonly id: string;
  readonly payload?: {
    readonly headers?: readonly GmailMessageHeader[];
    readonly body?: { readonly data?: string };
    readonly parts?: readonly GmailMessagePart[];
  };
}

interface GmailSendResponse {
  readonly id: string;
}

interface CalendarEventsListResponse {
  readonly items?: readonly CalendarEventResource[];
}

interface CalendarEventResource {
  readonly id: string;
  readonly summary?: string;
  readonly start?: { readonly dateTime?: string; readonly date?: string };
  readonly end?: { readonly dateTime?: string; readonly date?: string };
  readonly organizer?: { readonly self?: boolean };
  readonly attendees?: readonly { readonly email: string }[];
}

function decodeBase64Url(data: string): string {
  const normalized = data.replaceAll("-", "+").replaceAll("_", "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function encodeBase64Url(data: string): string {
  return Buffer.from(data, "utf8")
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll(/=+$/g, "");
}

function extractPlainTextBody(payload: GmailMessageResource["payload"]): string {
  if (!payload) return "";
  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  const parts = payload.parts ?? [];
  const plainPart = parts.find((part) => part.mimeType === "text/plain");
  if (plainPart?.body?.data) return decodeBase64Url(plainPart.body.data);
  const anyPartWithBody = parts.find((part) => part.body?.data);
  return anyPartWithBody?.body?.data ? decodeBase64Url(anyPartWithBody.body.data) : "";
}

function header(headers: readonly GmailMessageHeader[] | undefined, name: string): string {
  return headers?.find((entry) => entry.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function buildGmailSearchQuery(query: EmailQuery): string {
  const clauses: string[] = [];
  if (query.from) clauses.push(`from:${query.from}`);
  if (query.subject) clauses.push(`subject:${query.subject}`);
  return clauses.join(" ");
}

function toEpochMillis(
  value: { readonly dateTime?: string; readonly date?: string } | undefined,
): number {
  if (!value) return 0;
  if (value.dateTime) return new Date(value.dateTime).getTime();
  if (value.date) return new Date(`${value.date}T00:00:00Z`).getTime();
  return 0;
}

/**
 * Google's own client libraries default to 5–10 concurrent HTTP/2 streams
 * per connection for exactly this reason; matching that order of
 * magnitude keeps the desktop process from ever holding significantly
 * more than a handful of decoded JSON message bodies in memory at once,
 * while still overlapping enough requests that total wall-clock time for
 * a full page stays close to the unbounded-concurrency case.
 */
const GMAIL_DETAIL_FETCH_CONCURRENCY = 5;

/**
 * Maps `items` through `task`, running at most `concurrency` tasks at
 * once, preserving input order in the returned array. Unlike
 * `Promise.all(items.map(task))`, memory held by in-flight work never
 * exceeds `concurrency` items regardless of how large `items` is — the
 * two approaches make exactly the same number of calls to `task` and
 * produce an identical result, only the peak number of *simultaneously
 * pending* calls differs.
 */
async function fetchWithBoundedConcurrency<TInput, TOutput>(
  items: readonly TInput[],
  concurrency: number,
  task: (item: TInput) => Promise<TOutput>,
): Promise<TOutput[]> {
  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await task(items[currentIndex]);
    }
  };
  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/**
 * Gmail-backed `EmailProvider`. Read is scoped to the 25 most recent matches
 * for the given query (Gmail's list endpoint is paginated; NOVA's
 * `EmailQuery` contract has no pagination cursor of its own yet, so this
 * matches the same one-page-at-a-time boundary `EmailAssistant.read` already
 * expects from any provider).
 */
export class GmailProvider implements EmailProvider {
  private readonly fetcher: typeof fetch;
  private readonly endpoint: string;

  public constructor(private readonly options: GoogleProviderOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.endpoint = (options.gmailEndpoint ?? DEFAULT_GMAIL_ENDPOINT).replace(/\/$/, "");
  }

  public async read(query: EmailQuery): Promise<readonly EmailMessage[]> {
    const ids = await this.listMessageIds(query, 25);
    return await this.fetchMessageDetails(ids, "full");
  }

  /**
   * Returns just enough to render a notification-style list item —
   * sender and subject, no body or attachments — for the `count` most
   * recent messages matching `query`. Exists because the desktop
   * briefing source previously called `read()` (25 full messages, each
   * fully MIME-decoded) purely to discard all but the first 5 and use
   * only their headers; requesting `format=metadata` here means Gmail
   * itself never sends the body or attachment bytes over the wire for
   * those, rather than NOVA discarding them locally after paying to
   * download and decode them anyway.
   */
  public async readHeadersOnly(query: EmailQuery, count: number): Promise<readonly EmailMessage[]> {
    const ids = await this.listMessageIds(query, count);
    return await this.fetchMessageDetails(ids, "metadata");
  }

  private async listMessageIds(
    query: EmailQuery,
    maxResults: number,
  ): Promise<readonly { readonly id: string }[]> {
    const token = await this.options.tokenSource.getAccessToken();
    const searchQuery = buildGmailSearchQuery(query);
    const listUrl = new URL(`${this.endpoint}/users/me/messages`);
    listUrl.searchParams.set("maxResults", String(maxResults));
    if (searchQuery) listUrl.searchParams.set("q", searchQuery);
    const listResponse = await this.fetcher(listUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!listResponse.ok) {
      throw new Error(`Gmail list request failed with status ${listResponse.status}.`);
    }
    const list = (await listResponse.json()) as GmailListMessagesResponse;
    return list.messages ?? [];
  }

  private async fetchMessageDetails(
    ids: readonly { readonly id: string }[],
    format: "full" | "metadata",
  ): Promise<readonly EmailMessage[]> {
    const token = await this.options.tokenSource.getAccessToken();
    // Fetched with bounded concurrency rather than `Promise.all` over the
    // full batch: with up to 25 candidate IDs, unbounded fan-out means
    // up to 25 full message bodies (each already decoded from
    // base64url, doubling its transient memory footprint) live in the
    // heap simultaneously before the first one is even returned to the
    // caller. Capping in-flight requests bounds peak memory to a small,
    // fixed multiple of one message's size regardless of how large
    // `ids` grows, with no change to the final result, its ordering, or
    // total requests made.
    return await fetchWithBoundedConcurrency(
      ids,
      GMAIL_DETAIL_FETCH_CONCURRENCY,
      async ({ id }) => {
        const detailUrl = new URL(`${this.endpoint}/users/me/messages/${id}`);
        detailUrl.searchParams.set("format", format);
        if (format === "metadata") {
          detailUrl.searchParams.append("metadataHeaders", "From");
          detailUrl.searchParams.append("metadataHeaders", "Subject");
        }
        const detailResponse = await this.fetcher(detailUrl, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!detailResponse.ok) {
          throw new Error(`Gmail message fetch failed with status ${detailResponse.status}.`);
        }
        const resource = (await detailResponse.json()) as GmailMessageResource;
        const message: EmailMessage = {
          id: resource.id,
          sender: header(resource.payload?.headers, "From"),
          subject: header(resource.payload?.headers, "Subject"),
          body: format === "full" ? extractPlainTextBody(resource.payload) : "",
          attachments: [],
        };
        return message;
      },
    );
  }

  public async send(draft: EmailDraft): Promise<EmailSendReceipt> {
    const token = await this.options.tokenSource.getAccessToken();
    const rfc822 = [
      `To: ${draft.to}`,
      `Subject: ${draft.subject}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      draft.body,
    ].join("\r\n");
    const response = await this.fetcher(`${this.endpoint}/users/me/messages/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: encodeBase64Url(rfc822) }),
    });
    if (!response.ok) {
      throw new Error(`Gmail send request failed with status ${response.status}.`);
    }
    const sent = (await response.json()) as GmailSendResponse;
    return { ...draft, message_id: sent.id };
  }
}

/**
 * Google Calendar-backed `CalendarProvider`. `list()` returns the next 90
 * days of events on the configured calendar (matching `CalendarAssistant`'s
 * own "upcoming" framing — it has no date-range parameter to forward yet).
 */
export class GoogleCalendarProvider implements CalendarProvider {
  public readonly calendar_id: string;
  private readonly fetcher: typeof fetch;
  private readonly endpoint: string;

  public constructor(private readonly options: GoogleProviderOptions) {
    this.calendar_id = options.calendarId ?? DEFAULT_CALENDAR_ID;
    this.fetcher = options.fetcher ?? fetch;
    this.endpoint = (options.calendarEndpoint ?? DEFAULT_CALENDAR_ENDPOINT).replace(/\/$/, "");
  }

  public async list(): Promise<readonly CalendarEvent[]> {
    const token = await this.options.tokenSource.getAccessToken();
    const now = new Date();
    const ninetyDaysOut = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    const listUrl = new URL(
      `${this.endpoint}/calendars/${encodeURIComponent(this.calendar_id)}/events`,
    );
    listUrl.searchParams.set("timeMin", now.toISOString());
    listUrl.searchParams.set("timeMax", ninetyDaysOut.toISOString());
    listUrl.searchParams.set("singleEvents", "true");
    listUrl.searchParams.set("orderBy", "startTime");
    listUrl.searchParams.set("maxResults", "50");
    const response = await this.fetcher(listUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(`Calendar list request failed with status ${response.status}.`);
    }
    const list = (await response.json()) as CalendarEventsListResponse;
    return (list.items ?? []).map((item) => this.toCalendarEvent(item));
  }

  public async create(draft: CalendarDraft): Promise<CalendarEvent> {
    const token = await this.options.tokenSource.getAccessToken();
    const createUrl = `${this.endpoint}/calendars/${encodeURIComponent(this.calendar_id)}/events`;
    const response = await this.fetcher(createUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: draft.title,
        start: { dateTime: new Date(draft.start).toISOString() },
        end: { dateTime: new Date(draft.end).toISOString() },
        attendees: draft.attendees.map((email) => ({ email })),
      }),
    });
    if (!response.ok) {
      throw new Error(`Calendar create request failed with status ${response.status}.`);
    }
    const created = (await response.json()) as CalendarEventResource;
    return this.toCalendarEvent(created);
  }

  private toCalendarEvent(resource: CalendarEventResource): CalendarEvent {
    return {
      id: resource.id,
      title: resource.summary ?? "(no title)",
      start: toEpochMillis(resource.start),
      end: toEpochMillis(resource.end),
      owner: resource.organizer?.self ?? true,
      attendees: (resource.attendees ?? []).map((attendee) => attendee.email),
    };
  }
}

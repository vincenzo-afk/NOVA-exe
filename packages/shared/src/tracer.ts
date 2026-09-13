import { randomUUID } from "node:crypto";
import { appendJsonl, readJsonl } from "./jsonl-store.js";

/**
 * Implements docs/26-system-reference/23-tracing.md: every observable
 * operation carries a correlation ID; a child span inherits it and gets
 * its own span ID; each span records started_at/ended_at/status plus
 * the fields the doc's "Canonical span boundaries" table requires for
 * that span name. Lives in @nova/shared alongside StructuredLogger
 * since the doc treats logs and traces as complementary, sharing the
 * same correlation ID space (`docs/13-devops/logging.md`).
 */

export const SPAN_NAMES = [
  "nova.task",
  "nova.plan",
  "nova.tool",
  "nova.memory.query",
  "nova.provider.call",
  "nova.bus.publish",
] as const;
export type SpanName = (typeof SPAN_NAMES)[number];

/** The doc's "Required fields" column, per span name — enforced at startSpan. */
const requiredFields: Readonly<Record<SpanName, readonly string[]>> = {
  "nova.task": ["task_id", "task_type", "workspace_id"],
  "nova.plan": ["task_id", "step_count", "risk_tier"],
  "nova.tool": ["tool_id", "risk_tier"],
  "nova.memory.query": ["branch", "workspace_id"],
  "nova.provider.call": ["provider_id", "capability"],
  "nova.bus.publish": ["topic", "schema_version"],
};

export type SpanStatus = "in_progress" | "ok" | "error";

export interface Span {
  readonly span_id: string;
  readonly parent_span_id?: string;
  readonly correlation_id: string;
  readonly name: SpanName;
  readonly started_at: string;
  readonly ended_at?: string;
  readonly status: SpanStatus;
  readonly fields: Readonly<Record<string, unknown>>;
}

export interface SpanSink {
  write(span: Span): void;
}

export interface TracerOptions {
  readonly now?: () => string;
  readonly retentionMs?: number;
  readonly maxSpans?: number;
  /** Optional persistence: every startSpan/endSpan mutation writes the span's current snapshot. */
  readonly sink?: SpanSink;
}

const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const DEFAULT_MAX_SPANS = 10_000;

export class Tracer {
  private readonly spans = new Map<string, Span>();
  private readonly now: () => string;
  private readonly retentionMs: number;
  private readonly maxSpans: number;
  private readonly sink: SpanSink | undefined;

  public constructor(options: TracerOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
    this.maxSpans = options.maxSpans ?? DEFAULT_MAX_SPANS;
    this.sink = options.sink;
  }

  /**
   * Starts a span, validating it carries the required fields for its
   * name (the doc's per-span "Required fields" column) — an incomplete
   * span is a bug in the caller, not something to silently accept, the
   * same discipline `docs/26-system-reference/23-tracing.md`'s "Failure
   * behavior" section applies to trace *propagation* failures (fail
   * loud locally, never block the user operation).
   */
  public startSpan(
    name: SpanName,
    correlationId: string,
    fields: Readonly<Record<string, unknown>>,
    parentSpanId?: string,
  ): string {
    const missing = requiredFields[name].filter((field) => !(field in fields));
    if (missing.length > 0) {
      throw new Error(`Span '${name}' is missing required fields: ${missing.join(", ")}.`);
    }
    const spanId = randomUUID();
    const span: Span = {
      span_id: spanId,
      ...(parentSpanId === undefined ? {} : { parent_span_id: parentSpanId }),
      correlation_id: correlationId,
      name,
      started_at: this.now(),
      status: "in_progress",
      fields,
    };
    this.spans.set(spanId, span);
    this.prune();
    this.sink?.write(span);
    return spanId;
  }

  public endSpan(
    spanId: string,
    status: Exclude<SpanStatus, "in_progress">,
    additionalFields: Readonly<Record<string, unknown>> = {},
  ): void {
    const span = this.spans.get(spanId);
    if (!span) return;
    const updated: Span = {
      ...span,
      ended_at: this.now(),
      status,
      fields: { ...span.fields, ...additionalFields },
    };
    this.spans.set(spanId, updated);
    this.sink?.write(updated);
  }

  /** All spans for a correlation ID, oldest first — `nova traces <correlation-id>`'s data source. */
  public query(correlationId: string): readonly Span[] {
    return [...this.spans.values()]
      .filter((span) => span.correlation_id === correlationId)
      .sort((a, b) => a.started_at.localeCompare(b.started_at));
  }

  private prune(): void {
    const cutoff = Date.parse(this.now()) - this.retentionMs;
    for (const [id, span] of this.spans) {
      if (Date.parse(span.started_at) < cutoff) this.spans.delete(id);
    }
    const overflow = this.spans.size - this.maxSpans;
    if (overflow > 0) {
      const oldestFirst = [...this.spans.entries()].sort((a, b) =>
        a[1].started_at.localeCompare(b[1].started_at),
      );
      for (const [id] of oldestFirst.slice(0, overflow)) this.spans.delete(id);
    }
  }
}

/**
 * Persistent span storage, mirroring `FileJsonlLogSink`'s role for
 * logs — closes "Remaining, in priority order" item 2 from the
 * previous audit pass: a standalone `nova traces` invocation had
 * nowhere to read spans from beyond its own process's lifetime.
 * Appends one JSONL line per span mutation (start, then end); the last
 * line for a given `span_id` is its current state, same reconciliation
 * `FileJsonlLogSink` doesn't need (logs are append-only) but a
 * two-phase start/end span does.
 */
export class FileSpanStore implements SpanSink {
  public constructor(private readonly path: string) {}

  public write(span: Span): void {
    appendJsonl(this.path, span);
  }

  /** Reads every mutation back and keeps only the latest write per span_id. */
  public spans(): readonly Span[] {
    const latestBySpanId = new Map<string, Span>();
    for (const span of readJsonl<Span>(this.path)) latestBySpanId.set(span.span_id, span);
    return [...latestBySpanId.values()];
  }

  public query(correlationId: string): readonly Span[] {
    return this.spans()
      .filter((span) => span.correlation_id === correlationId)
      .sort((a, b) => a.started_at.localeCompare(b.started_at));
  }
}

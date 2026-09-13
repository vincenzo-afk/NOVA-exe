import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type LogLevel = "debug" | "info" | "warning" | "error" | "critical";

export interface LogRecord {
  readonly timestamp: string;
  readonly service: string;
  readonly severity: LogLevel;
  readonly event: string;
  readonly correlation_id?: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface LogSink {
  write(record: LogRecord): void;
}

export interface StructuredLoggerOptions {
  readonly service: string;
  readonly sink: LogSink;
  readonly minimumLevel?: LogLevel;
  readonly now?: () => string;
  readonly maxDetailStringLength?: number;
}

export interface RetainedLogSinkOptions {
  readonly retentionMs?: number;
  readonly maxRecords?: number;
}

const levelRank: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warning: 30,
  error: 40,
  critical: 50,
};
const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const DEFAULT_MAX_RECORDS = 10_000;
const DEFAULT_MAX_DETAIL_STRING_LENGTH = 512;
const protectedKey =
  /(credential|secret|token|api[_-]?key|password|authorization|cookie|session[_-]?id|page[_-]?body|form|entered[_-]?text|keystroke|clipboard|notification[_-]?body|screenshot|base64|raw[_-]?content|content)/i;

export class StructuredLogger {
  private readonly minimumLevel: LogLevel;
  private readonly now: () => string;
  private readonly maxDetailStringLength: number;

  public constructor(private readonly options: StructuredLoggerOptions) {
    if (options.service.length === 0) throw new Error("Logger service name is required.");
    this.minimumLevel = options.minimumLevel ?? "info";
    this.now = options.now ?? (() => new Date().toISOString());
    this.maxDetailStringLength = options.maxDetailStringLength ?? DEFAULT_MAX_DETAIL_STRING_LENGTH;
  }

  public log(
    severity: LogLevel,
    event: string,
    details: Readonly<Record<string, unknown>> = {},
    correlationId?: string,
    timestamp = this.now(),
  ): void {
    if (levelRank[severity] < levelRank[this.minimumLevel]) return;
    if (!isIsoTimestamp(timestamp))
      throw new Error("Structured log timestamp must be ISO-8601 UTC.");
    const record: LogRecord = {
      timestamp,
      service: this.options.service,
      severity,
      event: bound(event, 160, "logger.event"),
      ...(correlationId === undefined
        ? {}
        : { correlation_id: bound(correlationId, 128, "logger.correlation_id") }),
      details: sanitizeRecord(details, this.maxDetailStringLength),
    };
    this.options.sink.write(record);
  }

  public debug(
    event: string,
    details: Readonly<Record<string, unknown>> = {},
    correlationId?: string,
    timestamp?: string,
  ): void {
    this.log("debug", event, details, correlationId, timestamp ?? this.now());
  }

  public info(
    event: string,
    details: Readonly<Record<string, unknown>> = {},
    correlationId?: string,
    timestamp?: string,
  ): void {
    this.log("info", event, details, correlationId, timestamp ?? this.now());
  }

  public warning(
    event: string,
    details: Readonly<Record<string, unknown>> = {},
    correlationId?: string,
    timestamp?: string,
  ): void {
    this.log("warning", event, details, correlationId, timestamp ?? this.now());
  }

  public error(
    event: string,
    details: Readonly<Record<string, unknown>> = {},
    correlationId?: string,
    timestamp?: string,
  ): void {
    this.log("error", event, details, correlationId, timestamp ?? this.now());
  }

  public critical(
    event: string,
    details: Readonly<Record<string, unknown>> = {},
    correlationId?: string,
    timestamp?: string,
  ): void {
    this.log("critical", event, details, correlationId, timestamp ?? this.now());
  }
}

export class MemoryLogSink implements LogSink {
  private readonly values: LogRecord[] = [];
  private readonly retentionMs: number;
  private readonly maxRecords: number;

  public constructor(options: RetainedLogSinkOptions = {}) {
    this.retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
    this.maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
  }

  public write(record: LogRecord): void {
    this.values.push(record);
    this.prune(record.timestamp);
  }

  public records(): readonly LogRecord[] {
    return this.values.map((record) => ({ ...record, details: { ...record.details } }));
  }

  private prune(now: string): void {
    const cutoff = Date.parse(now) - this.retentionMs;
    const retained = this.values.filter((record) => Date.parse(record.timestamp) >= cutoff);
    this.values.splice(0, this.values.length, ...retained);
    if (this.values.length > this.maxRecords) {
      this.values.splice(0, this.values.length - this.maxRecords);
    }
  }
}

export class FileJsonlLogSink implements LogSink {
  private readonly retentionMs: number;
  private readonly maxRecords: number;

  public constructor(
    private readonly path: string,
    options: RetainedLogSinkOptions = {},
  ) {
    this.retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
    this.maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
  }

  public write(record: LogRecord): void {
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, `${JSON.stringify(record)}\n`, "utf8");
    this.prune(record.timestamp);
  }

  /** Reads back everything currently on disk — the `nova logs` query path. */
  public records(): readonly LogRecord[] {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, "utf8")
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as LogRecord);
  }

  private prune(now: string): void {
    if (!existsSync(this.path)) return;
    const cutoff = Date.parse(now) - this.retentionMs;
    const records = readFileSync(this.path, "utf8")
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as LogRecord)
      .filter((record) => Date.parse(record.timestamp) >= cutoff)
      .slice(-this.maxRecords);
    writeFileSync(
      this.path,
      records.length === 0 ? "" : `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
      "utf8",
    );
  }
}

function sanitizeRecord(
  details: Readonly<Record<string, unknown>>,
  maxStringLength: number,
): Readonly<Record<string, unknown>> {
  return sanitizeValue(details, undefined, maxStringLength, new WeakSet<object>()) as Readonly<
    Record<string, unknown>
  >;
}

function sanitizeValue(
  value: unknown,
  key: string | undefined,
  maxStringLength: number,
  seen: WeakSet<object>,
): unknown {
  if (key !== undefined && protectedKey.test(key)) return "[REDACTED]";
  if (typeof value === "string") return sanitizeString(value, maxStringLength);
  if (Array.isArray(value)) {
    if (seen.has(value)) return "[CIRCULAR]";
    seen.add(value);
    return value.slice(0, 64).map((item) => sanitizeValue(item, key, maxStringLength, seen));
  }
  if (value !== null && typeof value === "object") {
    if (seen.has(value)) return "[CIRCULAR]";
    seen.add(value);
    const result: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value).slice(0, 128)) {
      result[entryKey] = sanitizeValue(entryValue, entryKey, maxStringLength, seen);
    }
    return result;
  }
  return value;
}

function sanitizeString(value: string, maxLength: number): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk|gsk)_[A-Za-z0-9_-]+\b/g, "[REDACTED_TOKEN]")
    .slice(0, maxLength);
}

function bound(value: string, maxLength: number, field: string): string {
  if (value.length === 0) throw new Error(`${field} is required.`);
  return value.slice(0, maxLength);
}

function isIsoTimestamp(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

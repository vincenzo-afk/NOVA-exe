import { appendJsonl, readJsonl } from "./jsonl-store.js";

/**
 * Local metrics store per docs/26-system-reference/22-metrics-catalog.md:
 * Gauges (latest value wins), Counters (monotonic sum), and Histograms
 * (distribution stats), each keyed by name + label set — e.g.
 * `nova.resource.cpu_pct` labeled by `service_id`,
 * `nova.tool.invocation_count` labeled by `tool_id`+`result`. Feeds
 * `nova metrics` (docs/27-cli/05-observability-commands.md) and, per
 * that catalog doc, is fed by traces/logs elsewhere — this class only
 * stores and aggregates what it's given, consistent with
 * `docs/00-overview/non-goals.md`'s local-first stance (no external
 * telemetry pipeline).
 */

export type MetricKind = "gauge" | "counter" | "histogram";

export interface MetricSample {
  readonly value: number;
  readonly labels: Readonly<Record<string, string>>;
  readonly recorded_at: string;
}

export interface GaugeSummary {
  readonly kind: "gauge";
  readonly value: number;
}
export interface CounterSummary {
  readonly kind: "counter";
  readonly value: number;
}
export interface HistogramSummary {
  readonly kind: "histogram";
  readonly count: number;
  readonly sum: number;
  readonly min: number;
  readonly max: number;
  readonly avg: number;
}
export type MetricSummary = GaugeSummary | CounterSummary | HistogramSummary;

export interface MetricEntry {
  readonly name: string;
  readonly kind: MetricKind;
  readonly value: number;
  readonly labels: Readonly<Record<string, string>>;
  readonly recorded_at: string;
}

export interface MetricSink {
  write(entry: MetricEntry): void;
}

export interface MetricsRegistryOptions {
  readonly now?: () => string;
  /** Optional persistence: every record() call is also written here. */
  readonly sink?: MetricSink;
}

function labelKey(labels: Readonly<Record<string, string>>): string {
  return Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
}

export class MetricsRegistry {
  private readonly now: () => string;
  private readonly kinds = new Map<string, MetricKind>();
  private readonly series = new Map<string, MetricSample[]>();
  private readonly sink: MetricSink | undefined;

  public constructor(options: MetricsRegistryOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.sink = options.sink;
  }

  public record(
    name: string,
    kind: MetricKind,
    value: number,
    labels: Readonly<Record<string, string>> = {},
  ): void {
    const existingKind = this.kinds.get(name);
    if (existingKind !== undefined && existingKind !== kind) {
      throw new Error(`Metric '${name}' was already recorded as a ${existingKind}, not a ${kind}.`);
    }
    this.kinds.set(name, kind);
    const seriesKey = `${name}\u0000${labelKey(labels)}`;
    const samples = this.series.get(seriesKey) ?? [];
    const recordedAt = this.now();
    samples.push({ value, labels, recorded_at: recordedAt });
    this.series.set(seriesKey, samples);
    this.sink?.write({ name, kind, value, labels, recorded_at: recordedAt });
  }

  /**
   * Aggregates every label combination recorded for `name` into one
   * summary per label set — the shape `nova metrics --json` returns.
   */
  public query(
    name: string,
  ): ReadonlyArray<{ readonly labels: Readonly<Record<string, string>> } & MetricSummary> {
    const kind = this.kinds.get(name);
    if (!kind) return [];
    const results: Array<{ readonly labels: Readonly<Record<string, string>> } & MetricSummary> =
      [];
    for (const [seriesKey, samples] of this.series) {
      if (!seriesKey.startsWith(`${name}\u0000`)) continue;
      const labels = samples[0]?.labels ?? {};
      if (kind === "gauge") {
        results.push({ labels, kind, value: samples[samples.length - 1]?.value ?? 0 });
      } else if (kind === "counter") {
        results.push({
          labels,
          kind,
          value: samples.reduce((sum, sample) => sum + sample.value, 0),
        });
      } else {
        const values = samples.map((sample) => sample.value);
        const sum = values.reduce((total, value) => total + value, 0);
        results.push({
          labels,
          kind,
          count: values.length,
          sum,
          min: Math.min(...values),
          max: Math.max(...values),
          avg: sum / values.length,
        });
      }
    }
    return results;
  }

  public names(): readonly string[] {
    return [...this.kinds.keys()];
  }
}

/**
 * Persistent metric storage, mirroring `FileSpanStore`'s role for
 * traces and `FileJsonlLogSink`'s for logs — same "Remaining, in
 * priority order" item 2 this pass closes for metrics too. Reads the
 * append-only entry log back and replays it into a fresh in-memory
 * `MetricsRegistry` so `query()`'s aggregation logic (latest-value for
 * gauges, sum for counters, count/sum/min/max/avg for histograms) isn't
 * duplicated here.
 */
export class FileMetricStore implements MetricSink {
  public constructor(private readonly path: string) {}

  public write(entry: MetricEntry): void {
    appendJsonl(this.path, entry);
  }

  private replay(): MetricsRegistry {
    const registry = new MetricsRegistry();
    for (const entry of readJsonl<MetricEntry>(this.path)) {
      registry.record(entry.name, entry.kind, entry.value, entry.labels);
    }
    return registry;
  }

  public query(
    name: string,
  ): ReadonlyArray<{ readonly labels: Readonly<Record<string, string>> } & MetricSummary> {
    return this.replay().query(name);
  }

  public names(): readonly string[] {
    return this.replay().names();
  }
}

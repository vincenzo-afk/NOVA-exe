import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileMetricStore, MetricsRegistry } from "../src/metrics-registry.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("MetricsRegistry", () => {
  it("reports the latest value for a gauge, not a sum or average", () => {
    const registry = new MetricsRegistry();
    registry.record("nova.resource.cpu_pct", "gauge", 10, { service_id: "runtime" });
    registry.record("nova.resource.cpu_pct", "gauge", 42, { service_id: "runtime" });

    expect(registry.query("nova.resource.cpu_pct")).toEqual([
      { labels: { service_id: "runtime" }, kind: "gauge", value: 42 },
    ]);
  });

  it("sums a counter's recorded increments", () => {
    const registry = new MetricsRegistry();
    registry.record("nova.tool.invocation_count", "counter", 1, { tool_id: "web_search", result: "success" });
    registry.record("nova.tool.invocation_count", "counter", 1, { tool_id: "web_search", result: "success" });
    registry.record("nova.tool.invocation_count", "counter", 1, { tool_id: "web_search", result: "failure" });

    const results = registry.query("nova.tool.invocation_count");
    expect(results).toContainEqual({
      labels: { tool_id: "web_search", result: "success" },
      kind: "counter",
      value: 2,
    });
    expect(results).toContainEqual({
      labels: { tool_id: "web_search", result: "failure" },
      kind: "counter",
      value: 1,
    });
  });

  it("computes count/sum/min/max/avg for a histogram", () => {
    const registry = new MetricsRegistry();
    for (const value of [10, 20, 30]) {
      registry.record("nova.retrieval.query_latency.ms", "histogram", value, { branch: "semantic" });
    }

    expect(registry.query("nova.retrieval.query_latency.ms")).toEqual([
      { labels: { branch: "semantic" }, kind: "histogram", count: 3, sum: 60, min: 10, max: 30, avg: 20 },
    ]);
  });

  it("keeps separate label combinations as separate series", () => {
    const registry = new MetricsRegistry();
    registry.record("nova.resource.cpu_pct", "gauge", 10, { service_id: "runtime" });
    registry.record("nova.resource.cpu_pct", "gauge", 90, { service_id: "memory" });

    expect(registry.query("nova.resource.cpu_pct")).toHaveLength(2);
  });

  it("rejects recording the same metric name under a different kind", () => {
    const registry = new MetricsRegistry();
    registry.record("nova.task.stuck_count", "gauge", 1);

    expect(() => registry.record("nova.task.stuck_count", "counter", 1)).toThrow(/already recorded/);
  });

  it("returns an empty array for a metric name that was never recorded", () => {
    const registry = new MetricsRegistry();
    expect(registry.query("nova.nonexistent")).toEqual([]);
  });
});

describe("FileMetricStore", () => {
  it("persists recorded metrics and replays them into aggregate queries after reload", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nova-metrics-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "metrics.jsonl");
    const store = new FileMetricStore(path);
    const registry = new MetricsRegistry({ sink: store });

    registry.record("nova.tool.invocation_count", "counter", 1, { tool_id: "web_search", result: "success" });
    registry.record("nova.tool.invocation_count", "counter", 1, { tool_id: "web_search", result: "success" });

    const reloaded = new FileMetricStore(path);
    expect(reloaded.query("nova.tool.invocation_count")).toEqual([
      { labels: { tool_id: "web_search", result: "success" }, kind: "counter", value: 2 },
    ]);
    expect(reloaded.names()).toEqual(["nova.tool.invocation_count"]);
  });

  it("returns an empty array before anything has been written", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nova-metrics-"));
    temporaryDirectories.push(directory);
    const store = new FileMetricStore(join(directory, "metrics.jsonl"));
    expect(store.query("nova.nonexistent")).toEqual([]);
    expect(store.names()).toEqual([]);
  });
});

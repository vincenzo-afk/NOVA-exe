import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileSpanStore, Tracer } from "../src/tracer.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("Tracer", () => {
  it("rejects starting a span that's missing its required fields", () => {
    const tracer = new Tracer({ now: () => "2026-08-24T10:00:00.000Z" });

    expect(() => tracer.startSpan("nova.task", "corr-1", { task_id: "task-1" })).toThrow(
      /missing required fields/,
    );
  });

  it("records started_at/ended_at/status and returns spans for a correlation ID in order", () => {
    let tick = 0;
    const timestamps = [
      "2026-08-24T10:00:00.000Z",
      "2026-08-24T10:00:01.000Z",
      "2026-08-24T10:00:02.000Z",
    ];
    const tracer = new Tracer({
      now: () => timestamps[tick++] ?? timestamps[timestamps.length - 1],
    });

    const taskSpan = tracer.startSpan("nova.task", "corr-1", {
      task_id: "task-1",
      task_type: "research",
      workspace_id: "ws-1",
    });
    const toolSpan = tracer.startSpan(
      "nova.tool",
      "corr-1",
      { tool_id: "web_search", risk_tier: "read_only" },
      taskSpan,
    );
    tracer.endSpan(toolSpan, "ok", { result: "success" });

    const spans = tracer.query("corr-1");
    expect(spans).toHaveLength(2);
    expect(spans[0]).toMatchObject({ name: "nova.task", status: "in_progress" });
    expect(spans[1]).toMatchObject({
      name: "nova.tool",
      parent_span_id: taskSpan,
      status: "ok",
      fields: { result: "success" },
    });
  });

  it("scopes queries to their own correlation ID", () => {
    const tracer = new Tracer({ now: () => "2026-08-24T10:00:00.000Z" });
    tracer.startSpan("nova.bus.publish", "corr-a", {
      topic: "task.created",
      schema_version: "1.0.0",
    });
    tracer.startSpan("nova.bus.publish", "corr-b", {
      topic: "task.created",
      schema_version: "1.0.0",
    });

    expect(tracer.query("corr-a")).toHaveLength(1);
    expect(tracer.query("corr-b")).toHaveLength(1);
    expect(tracer.query("corr-c")).toHaveLength(0);
  });

  it("ending an unknown span id is a no-op rather than an error", () => {
    const tracer = new Tracer({ now: () => "2026-08-24T10:00:00.000Z" });
    expect(() => tracer.endSpan("does-not-exist", "ok")).not.toThrow();
  });
});

describe("FileSpanStore", () => {
  it("persists span start/end mutations and reconciles to the latest state per span_id", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nova-traces-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "traces.jsonl");
    const store = new FileSpanStore(path);
    const tracer = new Tracer({ now: () => "2026-08-24T10:00:00.000Z", sink: store });

    const spanId = tracer.startSpan("nova.bus.publish", "corr-1", {
      topic: "task.created",
      schema_version: "1.0.0",
    });
    tracer.endSpan(spanId, "ok");

    const reloaded = new FileSpanStore(path);
    const spans = reloaded.query("corr-1");
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ status: "ok", ended_at: "2026-08-24T10:00:00.000Z" });
  });

  it("returns an empty array before any span has been written", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nova-traces-"));
    temporaryDirectories.push(directory);
    const store = new FileSpanStore(join(directory, "traces.jsonl"));
    expect(store.query("corr-1")).toEqual([]);
  });
});

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileJsonlLogSink, MemoryLogSink, StructuredLogger } from "../src/structured-logger.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("StructuredLogger", () => {
  it("emits required structured fields and recursively redacts protected details", () => {
    const sink = new MemoryLogSink();
    const logger = new StructuredLogger({
      service: "test.service",
      sink,
      now: () => "2026-08-24T10:00:00.000Z",
      minimumLevel: "debug",
    });

    logger.info(
      "permission.decision",
      {
        permission: "browser_metadata",
        granted: false,
        password: "do-not-record",
        nested: { api_key: "also-do-not-record" },
        page_body: "never persist this",
        message: "contact user@example.test",
      },
      "corr-123",
    );

    expect(sink.records()).toEqual([
      {
        timestamp: "2026-08-24T10:00:00.000Z",
        service: "test.service",
        severity: "info",
        event: "permission.decision",
        correlation_id: "corr-123",
        details: {
          permission: "browser_metadata",
          granted: false,
          password: "[REDACTED]",
          nested: { api_key: "[REDACTED]" },
          page_body: "[REDACTED]",
          message: "contact [REDACTED_EMAIL]",
        },
      },
    ]);
  });

  it("filters debug records without dropping warnings and errors", () => {
    const sink = new MemoryLogSink();
    const logger = new StructuredLogger({ service: "test.service", sink, minimumLevel: "info" });

    logger.debug("debug.detail", { step: 1 });
    logger.info("task.started", { task_id: "task-1" });
    logger.warning("task.degraded", { reason: "retry" });
    logger.error("task.failed", { error_code: "NOVA-TL002" });

    expect(sink.records().map((record) => record.severity)).toEqual(["info", "warning", "error"]);
  });

  it("bounds untrusted detail strings and records an explicit UTC timestamp", () => {
    const sink = new MemoryLogSink();
    const logger = new StructuredLogger({
      service: "test.service",
      sink,
      now: () => "2026-08-24T10:00:00.000Z",
    });

    logger.info("bounded.detail", { value: "x".repeat(600) });

    expect(sink.records()[0]?.timestamp).toMatch(/Z$/);
    expect((sink.records()[0]?.details.value as string).length).toBe(512);
  });

  it("prunes expired in-memory records without duplicating retained entries", () => {
    const sink = new MemoryLogSink({ retentionMs: 1_000 });
    sink.write({
      timestamp: "2026-08-24T10:00:00.000Z",
      service: "test.service",
      severity: "info",
      event: "old.record",
      details: {},
    });
    sink.write({
      timestamp: "2026-08-24T10:00:02.000Z",
      service: "test.service",
      severity: "info",
      event: "new.record",
      details: {},
    });

    expect(sink.records().map((record) => record.event)).toEqual(["new.record"]);
  });

  it("persists JSONL locally and prunes records outside the configured retention window", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nova-logs-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "nova.jsonl");
    const sink = new FileJsonlLogSink(path, { retentionMs: 1_000 });
    const logger = new StructuredLogger({ service: "test.service", sink });

    logger.info("old.record", { at: "old" }, undefined, "2026-08-24T10:00:00.000Z");
    logger.info("new.record", { at: "new" }, undefined, "2026-08-24T10:00:02.000Z");

    const lines = (await readFile(path, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ event: "new.record", service: "test.service" });
  });

  it("records() reads back what's currently on disk, and is empty before any write", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nova-logs-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "nova.jsonl");
    const sink = new FileJsonlLogSink(path);

    expect(sink.records()).toEqual([]);

    const logger = new StructuredLogger({ service: "test.service", sink });
    logger.info("first", {}, undefined, "2026-08-24T10:00:00.000Z");
    logger.warning("second", {}, "corr-1", "2026-08-24T10:00:01.000Z");

    expect(sink.records().map((record) => record.event)).toEqual(["first", "second"]);
  });
});

import { resolve } from "node:path";
import { PrismaClient } from "../src/generated/index.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "../src/memory-store.js";
import { MemoryVersioning } from "../src/memory-versioning.js";

const databaseUrl = `file:${resolve("services/memory/prisma/test.db")}`;
const client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

const unwrap = <T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }) => {
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
};

describe("MemoryStore", () => {
  let store: MemoryStore;

  beforeAll(async () => {
    await client.$connect();
    store = new MemoryStore(client, "workspace-a");
  });

  beforeEach(async () => {
    await client.workingMemoryEntry.deleteMany();
    await client.recentMemoryEntry.deleteMany();
    await client.longTermMemoryEntry.deleteMany();
  });

  afterAll(async () => {
    await client.$disconnect();
  });

  it("promotes working memory to recent memory but requires verification for long-term promotion", async () => {
    const working = unwrap(
      await store.writeWorking({
        taskId: "task-1",
        contentRef: "outcome-1",
        schemaVersion: "1.0.0",
      }),
    );
    const recent = unwrap(
      await store.promoteWorkingToRecent({
        workingId: working.id,
        identityId: "identity-1",
        sourceTaskId: "task-1",
        confidence: 0.8,
      }),
    );

    const rejected = await store.promoteRecentToLongTerm({ recentId: recent.id, verified: false });
    const promoted = unwrap(
      await store.promoteRecentToLongTerm({ recentId: recent.id, verified: true }),
    );

    expect(rejected).toMatchObject({ ok: false, error: { code: "NOVA-TSK004" } });
    expect(promoted.sourceLineageId).toBe(recent.id);
  });

  it("keeps memory scoped to the workspace database boundary", async () => {
    const working = unwrap(
      await store.writeWorking({ taskId: "task-1", contentRef: "private", schemaVersion: "1.0.0" }),
    );
    const recent = unwrap(
      await store.promoteWorkingToRecent({
        workingId: working.id,
        identityId: "identity-1",
        sourceTaskId: "task-1",
        confidence: 0.9,
      }),
    );
    const otherWorkspace = new MemoryStore(client, "workspace-b");

    const result = await otherWorkspace.readRecent(recent.id);

    expect(result).toMatchObject({ ok: false, error: { code: "NOVA-MEM003" } });
  });

  it("detects checksum corruption instead of returning tampered content", async () => {
    const working = unwrap(
      await store.writeWorking({
        taskId: "task-1",
        contentRef: "original",
        schemaVersion: "1.0.0",
      }),
    );
    const recent = unwrap(
      await store.promoteWorkingToRecent({
        workingId: working.id,
        identityId: "identity-1",
        sourceTaskId: "task-1",
        confidence: 0.9,
      }),
    );
    await client.$executeRaw`UPDATE recent_memory_entries SET content_ref = 'tampered' WHERE id = ${recent.id}`;

    const result = await store.readRecent(recent.id);

    expect(result).toMatchObject({ ok: false, error: { code: "NOVA-MEM001" } });
  });

  it("retains superseded records and links them to the replacement", async () => {
    const first = unwrap(
      await store.writeRecent({
        identityId: "identity-1",
        sourceTaskId: "task-1",
        contentRef: "old",
        confidence: 0.6,
        schemaVersion: "1.0.0",
      }),
    );
    const replacement = unwrap(
      await store.writeRecent({
        identityId: "identity-1",
        sourceTaskId: "task-1",
        contentRef: "new",
        confidence: 0.95,
        schemaVersion: "1.0.0",
      }),
    );

    unwrap(await store.supersedeRecent(first.id, replacement.id));
    const stored = unwrap(await store.readRecent(first.id));

    expect(stored.status).toBe("SUPERSEDED");
    expect(stored.supersededById).toBe(replacement.id);
  });

  it("excludes superseded records from search by default, but includes them when explicitly asked", async () => {
    const first = unwrap(
      await store.writeRecent({
        identityId: "identity-1",
        sourceTaskId: "task-1",
        contentRef: "prefers python for scripting",
        confidence: 0.6,
        schemaVersion: "1.0.0",
      }),
    );
    const replacement = unwrap(
      await store.writeRecent({
        identityId: "identity-1",
        sourceTaskId: "task-1",
        contentRef: "prefers python for scripting, later corrected to rust",
        confidence: 0.95,
        schemaVersion: "1.0.0",
      }),
    );
    unwrap(await store.supersedeRecent(first.id, replacement.id));

    const defaultResults = unwrap(await store.search({ query: "python" }));
    expect(defaultResults.map((result) => result.record_id)).toEqual([replacement.id]);

    const historicalResults = unwrap(
      await store.search({ query: "python", filters: { include_superseded: true } }),
    );
    expect(historicalResults.map((result) => result.record_id).sort()).toEqual(
      [first.id, replacement.id].sort(),
    );
  });

  it("searches all memory tiers within the workspace and returns stable record summaries", async () => {
    const working = unwrap(
      await store.writeWorking({
        taskId: "task-1",
        contentRef: "deployment decision",
        schemaVersion: "1.0.0",
      }),
    );
    const recent = unwrap(
      await store.promoteWorkingToRecent({
        workingId: working.id,
        identityId: "identity-1",
        sourceTaskId: "task-1",
        confidence: 0.82,
      }),
    );
    unwrap(
      await store.writeRecent({
        identityId: "identity-2",
        sourceTaskId: "task-2",
        contentRef: "unrelated note",
        confidence: 0.4,
        schemaVersion: "1.0.0",
      }),
    );

    const results = unwrap(await store.search({ query: "DEPLOYMENT" }));

    expect(results).toHaveLength(2);
    expect(results.map((result) => result.record_id)).toEqual([recent.id, working.id]);
    expect(results[0]).toMatchObject({
      tier: "recent",
      content_ref: "deployment decision",
      confidence: 0.82,
      lineage: [{ relation: "derived_from_task", source_record_id: "task-1" }],
    });
  });

  it("reads any tier by id and exposes long-term source lineage", async () => {
    const working = unwrap(
      await store.writeWorking({
        taskId: "task-1",
        contentRef: "verified deployment",
        schemaVersion: "1.0.0",
      }),
    );
    const recent = unwrap(
      await store.promoteWorkingToRecent({
        workingId: working.id,
        identityId: "identity-1",
        sourceTaskId: "task-1",
        confidence: 0.9,
      }),
    );
    const longTerm = unwrap(
      await store.promoteRecentToLongTerm({ recentId: recent.id, verified: true }),
    );

    const result = unwrap(await store.readRecord(longTerm.id));

    expect(result).toMatchObject({
      record_id: longTerm.id,
      tier: "long_term",
      content_ref: "verified deployment",
      lineage: [{ relation: "derived_from", source_record_id: recent.id }],
    });
  });
});

describe("MemoryVersioning", () => {
  it("accepts additive upgrades and rejects schema downgrades", () => {
    expect(MemoryVersioning.isForwardOrEqual("1.0.0", "1.1.0")).toBe(true);
    expect(MemoryVersioning.isForwardOrEqual("1.1.0", "1.0.0")).toBe(false);
    expect(MemoryVersioning.isForwardOrEqual("1.0.0", "1.0.0")).toBe(true);
  });
});

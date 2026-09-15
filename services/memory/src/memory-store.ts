import { createHash, randomUUID } from "node:crypto";
import { err, ok, type ErrorInfo, type Result } from "@nova/shared";
import type { PrismaClient } from "./generated/index.js";

interface WorkingInput {
  readonly taskId: string;
  readonly contentRef: string;
  readonly schemaVersion: string;
}

interface RecentInput {
  readonly identityId: string;
  readonly sourceTaskId: string;
  readonly contentRef: string;
  readonly confidence: number;
  readonly schemaVersion: string;
}

interface RecentPromotionInput {
  readonly workingId: string;
  readonly identityId: string;
  readonly sourceTaskId: string;
  readonly confidence: number;
}

interface LongTermPromotionInput {
  readonly recentId: string;
  readonly verified: boolean;
}

export type MemoryTier = "working" | "recent" | "long_term";

export interface MemorySearchInput {
  readonly query: string;
  readonly filters?: {
    readonly project?: string;
    readonly time_range?: { readonly start: string; readonly end: string };
    readonly entity_type?: string;
    /**
     * docs/04-memory/memory-conflict-resolution.md: "current retrieval
     * and context assembly prioritize the current, superseding fact by
     * default" — a superseded record stays reachable (Timeline Memory,
     * docs/04-memory/timeline.md, or an explicit readRecord/readRecent
     * by id) but should not resurface in ordinary search. Defaults to
     * false; set true for an explicit historical/"did this ever
     * change" query.
     */
    readonly include_superseded?: boolean;
  };
}

export interface MemoryLineage {
  readonly relation: "derived_from" | "derived_from_task";
  readonly source_record_id: string;
}

export interface MemoryRecordSummary {
  readonly record_id: string;
  readonly tier: MemoryTier;
  readonly content_ref: string;
  readonly confidence?: number;
  readonly schema_version: string;
  readonly created_at: string;
  readonly status?: string;
  readonly lineage: readonly MemoryLineage[];
}

export class MemoryStore {
  constructor(
    private readonly client: PrismaClient,
    private readonly workspaceId: string,
  ) {}

  async writeWorking(
    input: WorkingInput,
  ): Promise<Result<Awaited<ReturnType<PrismaClient["workingMemoryEntry"]["create"]>>>> {
    if (
      input.taskId.length === 0 ||
      input.contentRef.length === 0 ||
      input.schemaVersion.length === 0
    ) {
      return err(this.invalidInput("Working Memory input is incomplete."));
    }

    try {
      const row = await this.client.workingMemoryEntry.create({
        data: {
          id: randomUUID(),
          workspaceId: this.workspaceId,
          taskId: input.taskId,
          contentRef: input.contentRef,
          schemaVersion: input.schemaVersion,
          contentChecksum: checksum(input.contentRef),
        },
      });
      return ok(row);
    } catch (cause) {
      return err(this.storageError(cause));
    }
  }

  async writeRecent(
    input: RecentInput,
  ): Promise<Result<Awaited<ReturnType<PrismaClient["recentMemoryEntry"]["create"]>>>> {
    if (
      input.identityId.length === 0 ||
      input.sourceTaskId.length === 0 ||
      input.contentRef.length === 0 ||
      input.schemaVersion.length === 0 ||
      input.confidence < 0 ||
      input.confidence > 1
    ) {
      return err(this.invalidInput("Recent Memory input is invalid."));
    }

    try {
      const row = await this.client.recentMemoryEntry.create({
        data: {
          id: randomUUID(),
          workspaceId: this.workspaceId,
          identityId: input.identityId,
          sourceTaskId: input.sourceTaskId,
          contentRef: input.contentRef,
          confidence: input.confidence,
          schemaVersion: input.schemaVersion,
          contentChecksum: checksum(input.contentRef),
        },
      });
      return ok(row);
    } catch (cause) {
      return err(this.storageError(cause));
    }
  }

  async promoteWorkingToRecent(
    input: RecentPromotionInput,
  ): Promise<Result<Awaited<ReturnType<PrismaClient["recentMemoryEntry"]["create"]>>>> {
    if (input.confidence < 0 || input.confidence > 1) {
      return err(this.invalidInput("Recent Memory confidence must be between 0 and 1."));
    }

    try {
      const row = await this.client.$transaction(async (transaction) => {
        const working = await transaction.workingMemoryEntry.findFirst({
          where: { id: input.workingId, workspaceId: this.workspaceId },
        });
        if (!working) {
          throw new MemoryStoreFailure(
            "NOVA-MEM003",
            "Working Memory entry is outside this workspace.",
          );
        }

        return transaction.recentMemoryEntry.create({
          data: {
            id: randomUUID(),
            workspaceId: this.workspaceId,
            identityId: input.identityId,
            sourceTaskId: input.sourceTaskId,
            contentRef: working.contentRef,
            confidence: input.confidence,
            schemaVersion: working.schemaVersion,
            contentChecksum: working.contentChecksum,
          },
        });
      });
      return ok(row);
    } catch (cause) {
      return err(this.toError(cause));
    }
  }

  async promoteRecentToLongTerm(
    input: LongTermPromotionInput,
  ): Promise<Result<Awaited<ReturnType<PrismaClient["longTermMemoryEntry"]["create"]>>>> {
    if (!input.verified) {
      return err({
        code: "NOVA-TSK004",
        message: "Only independently verified memory can be promoted to Long-term Memory.",
        retryable: false,
      });
    }

    try {
      const row = await this.client.$transaction(async (transaction) => {
        const recent = await transaction.recentMemoryEntry.findFirst({
          where: { id: input.recentId, workspaceId: this.workspaceId },
        });
        if (!recent) {
          throw new MemoryStoreFailure(
            "NOVA-MEM003",
            "Recent Memory entry is outside this workspace.",
          );
        }

        return transaction.longTermMemoryEntry.create({
          data: {
            id: randomUUID(),
            workspaceId: this.workspaceId,
            identityId: recent.identityId,
            contentRef: recent.contentRef,
            confidence: recent.confidence,
            verifiedAt: new Date(),
            sourceLineageId: recent.id,
            schemaVersion: recent.schemaVersion,
            contentChecksum: recent.contentChecksum,
          },
        });
      });
      return ok(row);
    } catch (cause) {
      return err(this.toError(cause));
    }
  }

  /**
   * The same tier-scan and filter logic `search()` already uses, minus
   * the query-substring gate — for a caller (like `RetrievalEngine`)
   * that wants to score the full candidate set itself rather than have
   * candidates pre-excluded by a crude substring check before scoring
   * ever runs. `search()` itself is unchanged and still the right call
   * for a simple, direct lookup.
   */
  async listCandidates(
    filters: MemorySearchInput["filters"] = {},
  ): Promise<Result<readonly MemoryRecordSummary[]>> {
    const start = filters?.time_range?.start;
    const end = filters?.time_range?.end;
    if (
      (start !== undefined && Number.isNaN(Date.parse(start))) ||
      (end !== undefined && Number.isNaN(Date.parse(end))) ||
      (start !== undefined && end !== undefined && Date.parse(start) > Date.parse(end))
    ) {
      return err(this.invalidInput("Memory search time range is invalid."));
    }
    try {
      const [working, recent, longTerm] = await Promise.all([
        this.client.workingMemoryEntry.findMany({ where: { workspaceId: this.workspaceId } }),
        this.client.recentMemoryEntry.findMany({ where: { workspaceId: this.workspaceId } }),
        this.client.longTermMemoryEntry.findMany({ where: { workspaceId: this.workspaceId } }),
      ]);
      const records = [
        ...working.map((row) => this.toWorkingSummary(row)),
        ...recent.map((row) => this.toRecentSummary(row)),
        ...longTerm.map((row) => this.toLongTermSummary(row)),
      ];
      const project = filters?.project?.trim().toLocaleLowerCase();
      const entityType = filters?.entity_type?.trim().toLocaleLowerCase();
      const filtered = records
        .filter((record) => filters?.include_superseded === true || record.status !== "SUPERSEDED")
        .filter(
          (record) =>
            project === undefined || record.content_ref.toLocaleLowerCase().includes(project),
        )
        .filter(
          (record) =>
            entityType === undefined ||
            record.content_ref.toLocaleLowerCase().includes(entityType),
        )
        .filter((record) => {
          const createdAt = Date.parse(record.created_at);
          return (
            (start === undefined || createdAt >= Date.parse(start)) &&
            (end === undefined || createdAt <= Date.parse(end))
          );
        })
        .sort((left, right) => {
          const byDate = Date.parse(right.created_at) - Date.parse(left.created_at);
          if (byDate !== 0) return byDate;
          return left.record_id.localeCompare(right.record_id);
        });
      return ok(filtered);
    } catch (cause) {
      return err(this.storageError(cause));
    }
  }

  async search(input: MemorySearchInput): Promise<Result<readonly MemoryRecordSummary[]>> {
    if (input.query.trim().length === 0) {
      return err(this.invalidInput("Memory search query is required."));
    }
    const start = input.filters?.time_range?.start;
    const end = input.filters?.time_range?.end;
    if (
      (start !== undefined && Number.isNaN(Date.parse(start))) ||
      (end !== undefined && Number.isNaN(Date.parse(end))) ||
      (start !== undefined && end !== undefined && Date.parse(start) > Date.parse(end))
    ) {
      return err(this.invalidInput("Memory search time range is invalid."));
    }

    try {
      const [working, recent, longTerm] = await Promise.all([
        this.client.workingMemoryEntry.findMany({ where: { workspaceId: this.workspaceId } }),
        this.client.recentMemoryEntry.findMany({ where: { workspaceId: this.workspaceId } }),
        this.client.longTermMemoryEntry.findMany({ where: { workspaceId: this.workspaceId } }),
      ]);
      const records = [
        ...working.map((row) => this.toWorkingSummary(row)),
        ...recent.map((row) => this.toRecentSummary(row)),
        ...longTerm.map((row) => this.toLongTermSummary(row)),
      ];
      const query = input.query.trim().toLocaleLowerCase();
      const project = input.filters?.project?.trim().toLocaleLowerCase();
      const entityType = input.filters?.entity_type?.trim().toLocaleLowerCase();
      const filtered = records
        .filter(
          (record) => input.filters?.include_superseded === true || record.status !== "SUPERSEDED",
        )
        .filter((record) => record.content_ref.toLocaleLowerCase().includes(query))
        .filter(
          (record) =>
            project === undefined || record.content_ref.toLocaleLowerCase().includes(project),
        )
        .filter(
          (record) =>
            entityType === undefined || record.content_ref.toLocaleLowerCase().includes(entityType),
        )
        .filter((record) => {
          const createdAt = Date.parse(record.created_at);
          return (
            (start === undefined || createdAt >= Date.parse(start)) &&
            (end === undefined || createdAt <= Date.parse(end))
          );
        })
        .sort((left, right) => {
          const byDate = Date.parse(right.created_at) - Date.parse(left.created_at);
          if (byDate !== 0) return byDate;
          return left.record_id.localeCompare(right.record_id);
        });
      return ok(filtered);
    } catch (cause) {
      return err(this.storageError(cause));
    }
  }

  async readRecord(id: string): Promise<Result<MemoryRecordSummary>> {
    if (id.trim().length === 0) return err(this.invalidInput("Memory record id is required."));
    try {
      const [working, recent, longTerm] = await Promise.all([
        this.client.workingMemoryEntry.findFirst({
          where: { id, workspaceId: this.workspaceId },
        }),
        this.client.recentMemoryEntry.findFirst({
          where: { id, workspaceId: this.workspaceId },
        }),
        this.client.longTermMemoryEntry.findFirst({
          where: { id, workspaceId: this.workspaceId },
        }),
      ]);
      if (working) return ok(this.toWorkingSummary(working));
      if (recent) return ok(this.toRecentSummary(recent));
      if (longTerm) return ok(this.toLongTermSummary(longTerm));
      return err({
        code: "NOVA-MEM003",
        message: "Memory record is not available in this workspace.",
        retryable: false,
        details: { id },
      });
    } catch (cause) {
      return err(this.storageError(cause));
    }
  }

  async readRecent(
    id: string,
  ): Promise<Result<Awaited<ReturnType<PrismaClient["recentMemoryEntry"]["findFirst"]>>>> {
    try {
      const row = await this.client.recentMemoryEntry.findFirst({
        where: { id, workspaceId: this.workspaceId },
      });
      if (!row) {
        return err({
          code: "NOVA-MEM003",
          message: "Memory entry is not available in this workspace.",
          retryable: false,
          details: { id },
        });
      }
      if (checksum(row.contentRef) !== row.contentChecksum) {
        return err({
          code: "NOVA-MEM001",
          message: "Memory checksum mismatch detected.",
          retryable: false,
          details: { id },
        });
      }
      return ok(row);
    } catch (cause) {
      return err(this.storageError(cause));
    }
  }

  async supersedeRecent(oldId: string, replacementId: string): Promise<Result<void>> {
    try {
      await this.client.$transaction(async (transaction) => {
        const [oldEntry, replacement] = await Promise.all([
          transaction.recentMemoryEntry.findFirst({
            where: { id: oldId, workspaceId: this.workspaceId },
          }),
          transaction.recentMemoryEntry.findFirst({
            where: { id: replacementId, workspaceId: this.workspaceId },
          }),
        ]);
        if (!oldEntry || !replacement) {
          throw new MemoryStoreFailure(
            "NOVA-MEM003",
            "Supersession target is outside this workspace.",
          );
        }
        await transaction.recentMemoryEntry.update({
          where: { id: oldId },
          data: { status: "SUPERSEDED", supersededById: replacementId },
        });
      });
      return ok(undefined);
    } catch (cause) {
      return err(this.toError(cause));
    }
  }

  private toWorkingSummary(
    row: Awaited<ReturnType<PrismaClient["workingMemoryEntry"]["findFirst"]>> & object,
  ): MemoryRecordSummary {
    this.assertChecksum(row.contentRef, row.contentChecksum);
    return {
      record_id: row.id,
      tier: "working",
      content_ref: row.contentRef,
      schema_version: row.schemaVersion,
      created_at: row.createdAt.toISOString(),
      lineage: [{ relation: "derived_from_task", source_record_id: row.taskId }],
    };
  }

  private toRecentSummary(
    row: Awaited<ReturnType<PrismaClient["recentMemoryEntry"]["findFirst"]>> & object,
  ): MemoryRecordSummary {
    this.assertChecksum(row.contentRef, row.contentChecksum);
    return {
      record_id: row.id,
      tier: "recent",
      content_ref: row.contentRef,
      confidence: row.confidence,
      schema_version: row.schemaVersion,
      created_at: row.createdAt.toISOString(),
      status: row.status,
      lineage: [{ relation: "derived_from_task", source_record_id: row.sourceTaskId }],
    };
  }

  private toLongTermSummary(
    row: Awaited<ReturnType<PrismaClient["longTermMemoryEntry"]["findFirst"]>> & object,
  ): MemoryRecordSummary {
    this.assertChecksum(row.contentRef, row.contentChecksum);
    return {
      record_id: row.id,
      tier: "long_term",
      content_ref: row.contentRef,
      confidence: row.confidence,
      schema_version: row.schemaVersion,
      created_at: row.verifiedAt.toISOString(),
      lineage: [{ relation: "derived_from", source_record_id: row.sourceLineageId }],
    };
  }

  private assertChecksum(contentRef: string, contentChecksum: string): void {
    if (checksum(contentRef) !== contentChecksum) {
      throw new MemoryStoreFailure("NOVA-MEM001", "Memory checksum mismatch detected.");
    }
  }

  private invalidInput(message: string): ErrorInfo {
    return { code: "NOVA-CFG001", message, retryable: false };
  }

  private storageError(cause: unknown): ErrorInfo {
    return {
      code: "NOVA-MEM001",
      message: cause instanceof Error ? cause.message : "Memory storage operation failed.",
      retryable: true,
    };
  }

  private toError(cause: unknown): ErrorInfo {
    if (cause instanceof MemoryStoreFailure) {
      return { code: cause.code, message: cause.message, retryable: false };
    }
    return this.storageError(cause);
  }
}

class MemoryStoreFailure extends Error {
  constructor(
    readonly code: "NOVA-MEM001" | "NOVA-MEM003",
    message: string,
  ) {
    super(message);
  }
}

const checksum = (content: string): string => createHash("sha256").update(content).digest("hex");

import { randomUUID } from "node:crypto";

import { err, ok, type Result } from "@nova/shared";

/**
 * The messaging half of "no messaging, no roles, no merge logic"
 * (`docs/references/feature-gap-analysis.md` §5) — a real per-branch
 * inbox a spawned agent can send to and read from during its own run,
 * not just a fan-out-and-join with no communication in between.
 *
 * Scoped to one parent task's run: `MultiAgentCoordinator` constructs
 * one of these per `run()` call, seeded with that run's known branch
 * ids, and discards it once every branch finishes — this is not a
 * durable, cross-run message store.
 */

export interface AgentMessage {
  readonly message_id: string;
  readonly from_branch_id: string;
  readonly to_branch_id: string;
  readonly content: string;
  readonly sent_at_epoch_ms: number;
}

export class AgentMessageBus {
  private readonly inboxes = new Map<string, AgentMessage[]>();

  public constructor(
    branchIds: readonly string[],
    private readonly now: () => number = () => Date.now(),
  ) {
    for (const branchId of branchIds) this.inboxes.set(branchId, []);
  }

  public send(fromBranchId: string, toBranchId: string, content: string): Result<AgentMessage> {
    const inbox = this.inboxes.get(toBranchId);
    if (!inbox) {
      return err({
        code: "NOVA-TL003",
        message: `Unknown recipient branch '${toBranchId}' — it isn't part of this run.`,
        retryable: false,
      });
    }
    const message: AgentMessage = {
      message_id: randomUUID(),
      from_branch_id: fromBranchId,
      to_branch_id: toBranchId,
      content,
      sent_at_epoch_ms: this.now(),
    };
    inbox.push(message);
    return ok(message);
  }

  /** Returns and clears everything waiting for this branch — a message is delivered once, not re-readable, matching a normal inbox rather than a durable log. */
  public receive(branchId: string): readonly AgentMessage[] {
    const inbox = this.inboxes.get(branchId) ?? [];
    this.inboxes.set(branchId, []);
    return inbox;
  }

  /** Non-destructive peek, for observability/tests — does not drain the inbox the way `receive` does. */
  public peek(branchId: string): readonly AgentMessage[] {
    return [...(this.inboxes.get(branchId) ?? [])];
  }
}

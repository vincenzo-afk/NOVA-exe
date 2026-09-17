import type { CommunicationBus, ErrorInfo, Result, StructuredLogger } from "@nova/shared";
import { err, ok } from "@nova/shared";

import { AgentMessageBus, type AgentMessage } from "./agent-message-bus.js";
import {
  Executor,
  PermissionManager,
  type Planner,
  type ToolRegistration,
  type Verifier,
} from "./orchestration.js";
import { RuntimeTaskCoordinator } from "./runtime-task-coordinator.js";
import type { TaskManager, TaskRecord } from "./task-manager.js";
import type { ResourceManager } from "./resource-manager.js";

/**
 * Replaces the previous `MultiAgentCoordinator`, which was
 * `Promise.all` over caller-supplied closures with an upfront
 * permission-scope check — real in shape, but every branch had
 * already been fully planned and executed by the caller before this
 * class ever saw it. This version is the thing actually spawning and
 * running each branch: every branch gets its own `RuntimeTaskCoordinator`
 * (the same Plan → Execute → Observe → Replan engine a top-level task
 * gets, including automatic replanning and concurrent-step execution),
 * scoped to its own subset of the parent's tool allowlist, with a real
 * message channel between branches and a merge step based on each
 * branch's actual final `TaskRecord` rather than an opaque `unknown`.
 */

const MESSAGING_TOOL_ID = "nova.agent-messaging";

export interface AgentBranchSpec {
  readonly branch_id: string;
  /** A channel-facing identity name (`docs/24-collaboration/specialist-delegation.md`'s @mention routing) — carried as data on every result; this class does not itself wire it into any channel adapter. */
  readonly role?: string;
  readonly goal: string;
  /** The subset of tool_ids this branch's own PermissionManager will allow — must be a subset of the parent's permissions, checked before any branch runs. */
  readonly permission_scope: ReadonlySet<string>;
}

export interface AgentBranchResult {
  readonly branch_id: string;
  readonly role: string | undefined;
  readonly status: "completed" | "failed";
  readonly task_id: string | undefined;
  readonly task_state: TaskRecord["state"] | undefined;
  readonly step_history: TaskRecord["step_history"] | undefined;
  readonly error: ErrorInfo | undefined;
}

export interface ParentTaskResult {
  readonly parent_task_id: string;
  readonly status: "completed" | "partial";
  readonly branches: readonly AgentBranchResult[];
}

export interface AgentEventBus {
  readonly publish: (event: {
    readonly type: string;
    readonly parent_task_id: string;
    readonly branch_id: string;
    readonly status: string;
  }) => Promise<void>;
}

export interface MultiAgentCoordinatorOptions {
  readonly bus: AgentEventBus;
  readonly tasks: TaskManager;
  readonly planner: Planner;
  readonly verifier: Verifier;
  readonly tools: ReadonlyMap<string, ToolRegistration>;
  readonly events: CommunicationBus;
  readonly resourceManager?: ResourceManager;
  readonly logger?: StructuredLogger;
  readonly confirmationTimeoutMs?: number;
  readonly maxReplanAttempts?: number;
}

export class MultiAgentCoordinator {
  public constructor(private readonly options: MultiAgentCoordinatorOptions) {}

  public async run(
    parentTaskId: string,
    branches: readonly AgentBranchSpec[],
    parentPermissions: ReadonlySet<string>,
  ): Promise<Result<ParentTaskResult>> {
    for (const branch of branches) {
      for (const toolId of branch.permission_scope) {
        if (!parentPermissions.has(toolId)) {
          return err(
            this.securityError(
              `Branch '${branch.branch_id}' exceeds the parent task's permission scope.`,
            ),
          );
        }
      }
    }
    const branchIds = new Set(branches.map((branch) => branch.branch_id));
    if (branchIds.size !== branches.length) {
      return err(this.securityError("Duplicate branch_id in the same multi-agent run."));
    }

    const messageBus = new AgentMessageBus(branches.map((branch) => branch.branch_id));

    const results = await Promise.all(
      branches.map((branch) => this.runBranch(parentTaskId, branch, messageBus)),
    );

    const status = results.every((result) => result.status === "completed")
      ? "completed"
      : "partial";
    return ok({ parent_task_id: parentTaskId, status, branches: results });
  }

  private async runBranch(
    parentTaskId: string,
    branch: AgentBranchSpec,
    messageBus: AgentMessageBus,
  ): Promise<AgentBranchResult> {
    const scopedToolIds = new Set<string>([...branch.permission_scope, MESSAGING_TOOL_ID]);
    const scopedTools = new Map<string, ToolRegistration>(this.options.tools);
    scopedTools.set(MESSAGING_TOOL_ID, buildMessagingTool(branch.branch_id, messageBus));

    const permissionManager = new PermissionManager(
      {
        allowedToolIds: scopedToolIds,
        confirmationTimeoutMs: this.options.confirmationTimeoutMs ?? 0,
      },
      this.options.logger,
    );
    const executor = new Executor(
      permissionManager,
      scopedTools,
      this.options.resourceManager,
      this.options.logger,
    );
    const coordinator = new RuntimeTaskCoordinator({
      tasks: this.options.tasks,
      planner: this.options.planner,
      executor,
      verifier: this.options.verifier,
      events: this.options.events,
      ...(this.options.maxReplanAttempts === undefined
        ? {}
        : { maxReplanAttempts: this.options.maxReplanAttempts }),
    });

    const submitted = coordinator.submit({ goal: branch.goal, correlation_id: parentTaskId });
    if (!submitted.ok) {
      await this.publish(parentTaskId, branch.branch_id, "failed");
      return this.failure(branch, submitted.error);
    }

    let executed: Result<TaskRecord>;
    try {
      executed = await coordinator.execute(submitted.value.task_id);
    } catch (cause) {
      await this.publish(parentTaskId, branch.branch_id, "failed");
      return this.failure(branch, {
        code: "NOVA-TL002",
        message: cause instanceof Error ? cause.message : "Branch execution threw unexpectedly.",
        retryable: false,
      });
    }
    if (!executed.ok) {
      await this.publish(parentTaskId, branch.branch_id, "failed");
      return this.failure(branch, executed.error);
    }

    const status = executed.value.state === "Completed" ? "completed" : "failed";
    await this.publish(parentTaskId, branch.branch_id, status);
    return {
      branch_id: branch.branch_id,
      role: branch.role,
      status,
      task_id: executed.value.task_id,
      task_state: executed.value.state,
      step_history: executed.value.step_history,
      error: undefined,
    };
  }

  private async publish(parentTaskId: string, branchId: string, status: string): Promise<void> {
    await this.options.bus.publish({
      type: status === "completed" ? "agent.branch.completed" : "agent.branch.failed",
      parent_task_id: parentTaskId,
      branch_id: branchId,
      status,
    });
  }

  private failure(branch: AgentBranchSpec, error: ErrorInfo): AgentBranchResult {
    return {
      branch_id: branch.branch_id,
      role: branch.role,
      status: "failed",
      task_id: undefined,
      task_state: undefined,
      step_history: undefined,
      error,
    };
  }

  private securityError(message: string): ErrorInfo {
    return { code: "NOVA-SEC001", message, retryable: false };
  }
}

/**
 * A real, working tool every branch gets access to regardless of its
 * own declared `permission_scope` — the coordination channel itself
 * isn't something a branch author should need to explicitly request,
 * the same way a task doesn't need to separately request the ability
 * to be told its own risk-tier confirmation state.
 */
function buildMessagingTool(branchId: string, messageBus: AgentMessageBus): ToolRegistration {
  return {
    tool_id: MESSAGING_TOOL_ID,
    deterministic: false,
    actions: {
      send: {
        risk_tier: "read_only",
        verification_signal: "api_response",
        idempotent: false,
        execute: async (parameters) => {
          const toBranchId =
            typeof parameters["to_branch_id"] === "string" ? parameters["to_branch_id"] : undefined;
          const content =
            typeof parameters["content"] === "string" ? parameters["content"] : undefined;
          if (!toBranchId || !content) {
            return {
              status: "failure",
              evidence: { type: "api_response", value: { status: 400 } },
              affected_resources: [],
            };
          }
          const sent = messageBus.send(branchId, toBranchId, content);
          return {
            status: sent.ok ? "success" : "failure",
            evidence: { type: "api_response", value: { status: sent.ok ? 200 : 404 } },
            affected_resources: [],
          };
        },
      },
      check: {
        risk_tier: "read_only",
        verification_signal: "api_response",
        idempotent: true,
        execute: async () => {
          const messages: readonly AgentMessage[] = messageBus.receive(branchId);
          return {
            status: "success",
            evidence: {
              type: "api_response",
              value: { status: 200, message_count: messages.length, messages },
            },
            affected_resources: [],
          };
        },
      },
    },
  };
}

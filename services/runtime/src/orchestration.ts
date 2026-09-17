import { err, ok, type ErrorInfo, type Result, type StructuredLogger } from "@nova/shared";
import { z } from "zod";
import type { ResourceManager } from "./resource-manager.js";
import type { ToolRegistry } from "./tool-registry.js";

export type RiskTier = "read_only" | "reversible_write" | "destructive_irreversible";
export type ExecutionTier =
  | "native_runtime"
  | "internal_function"
  | "api"
  | "mcp"
  | "cli"
  | "accessibility"
  | "vision"
  | "keyboard_mouse";
export type VerificationSignal =
  "exit_code" | "api_response" | "file_hash" | "accessibility_state" | "none";
export type EvidenceType = VerificationSignal;
export type ExecutionStatus = "success" | "failure" | "partial";
export type VerificationOutcome = "verified" | "unverified" | "failed";
export type FailureCategory =
  "transient" | "permanent" | "user" | "external" | "security" | "validation" | "internal";

export interface ExecutionStep {
  readonly step_id: string;
  readonly task_id: string;
  readonly correlation_id: string;
  readonly capability_id: string;
  readonly resolved_tool_id: string;
  readonly action_id: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly risk_tier: RiskTier;
  readonly execution_tier: ExecutionTier;
  readonly required_locks: readonly string[];
  readonly timeout_ms: number;
  readonly confirmation_status: "not_required" | "pending" | "approved" | "denied";
  /**
   * Other steps in the *same plan* (by step_id) that must complete and pass
   * verification before this one may start. Omitted or empty means this step
   * has no prerequisites within the plan. This is what lets the coordinator
   * (`runtime-task-coordinator.ts`'s `computeExecutionWaves`) run genuinely
   * independent steps concurrently instead of always executing one giant
   * plan strictly in list order regardless of whether steps actually depend
   * on each other.
   */
  readonly depends_on?: readonly string[];
}

export interface ExecutionEvidence {
  readonly type: EvidenceType;
  readonly value: unknown;
}

export interface ExecutionError {
  readonly category: FailureCategory;
  readonly message: string;
}

export interface ExecutionResult {
  readonly step_id: string;
  readonly status: ExecutionStatus;
  readonly evidence: ExecutionEvidence;
  readonly affected_resources: readonly string[];
  readonly error?: ExecutionError;
}

export interface VerificationVerdict {
  readonly step_id: string;
  readonly outcome: VerificationOutcome;
  readonly confidence: number;
  readonly verification_method: "ground_truth" | "vision_secondary";
  readonly explanation: string;
}

export interface ToolAction {
  readonly risk_tier: RiskTier;
  readonly verification_signal: VerificationSignal;
  readonly idempotent: boolean;
  readonly execute: (
    parameters: Readonly<Record<string, unknown>>,
  ) => Promise<Omit<ExecutionResult, "step_id">>;
}

export interface ToolRegistration {
  readonly tool_id: string;
  readonly deterministic: boolean;
  readonly actions: Readonly<Record<string, ToolAction>>;
}

const executionStepSchema = z.object({
  step_id: z.string().min(1),
  task_id: z.string().min(1),
  correlation_id: z.string().uuid(),
  capability_id: z.string().min(1),
  resolved_tool_id: z.string().min(1),
  action_id: z.string().min(1),
  parameters: z.record(z.string(), z.unknown()),
  risk_tier: z.enum(["read_only", "reversible_write", "destructive_irreversible"]),
  execution_tier: z.enum([
    "native_runtime",
    "internal_function",
    "api",
    "mcp",
    "cli",
    "accessibility",
    "vision",
    "keyboard_mouse",
  ]),
  required_locks: z.array(z.string()),
  timeout_ms: z.number().int().positive(),
  confirmation_status: z.enum(["not_required", "pending", "approved", "denied"]),
  depends_on: z.array(z.string()).optional(),
});

export interface PlannerDependencies {
  readonly deterministic: ReadonlyMap<string, ExecutionStep>;
  readonly llmPlanner?: (goal: string) => Promise<readonly ExecutionStep[]>;
}

export class Planner {
  constructor(private readonly dependencies: PlannerDependencies) {}

  async plan(input: {
    readonly task_id: string;
    readonly goal: string;
  }): Promise<Result<readonly ExecutionStep[]>> {
    const deterministicStep = this.dependencies.deterministic.get(input.goal);
    if (deterministicStep) {
      const normalized = {
        ...deterministicStep,
        task_id: input.task_id,
        confirmation_status: "not_required" as const,
      };
      const parsed = executionStepSchema.safeParse(normalized);
      return parsed.success
        ? ok([parsed.data])
        : err(this.validationError("Deterministic step failed contract validation."));
    }

    if (!this.dependencies.llmPlanner) {
      return err({
        code: "NOVA-AI001",
        message: "No deterministic resolution exists and no model planner is available.",
        retryable: false,
      });
    }

    const candidates = await this.dependencies.llmPlanner(input.goal);
    const steps = candidates.map((candidate) => ({
      ...candidate,
      task_id: input.task_id,
      confirmation_status:
        candidate.confirmation_status === "approved" ? "pending" : candidate.confirmation_status,
    }));
    const parsed = z.array(executionStepSchema).safeParse(steps);
    return parsed.success
      ? ok(parsed.data)
      : err(this.validationError("Model-generated plan failed contract validation."));
  }

  private validationError(message: string): ErrorInfo {
    return { code: "NOVA-TL002", message, retryable: false };
  }
}

export interface PermissionOptions {
  readonly allowedToolIds: ReadonlySet<string>;
  readonly confirmationTimeoutMs: number;
}

export class PermissionManager {
  private readonly logger: StructuredLogger | undefined;

  constructor(
    private readonly options: PermissionOptions,
    logger?: StructuredLogger,
  ) {
    this.logger = logger;
  }

  authorize(step: ExecutionStep, tool: ToolRegistration): Result<"allowed"> {
    if (!this.options.allowedToolIds.has(tool.tool_id)) {
      return this.deny(
        step,
        tool.tool_id,
        "unknown",
        "NOVA-SEC001",
        "allowlist",
        "Tool is outside the agent-scoped allowlist.",
        { toolId: tool.tool_id },
      );
    }

    const action = tool.actions[step.action_id];
    if (!action) {
      return this.deny(
        step,
        tool.tool_id,
        "unknown",
        "NOVA-TL004",
        "missing_action",
        "Requested tool action is unavailable.",
      );
    }

    if (action.risk_tier === "read_only" && action.verification_signal !== "none") {
      this.logDecision(step, tool.tool_id, action.risk_tier, "allowed", "read_only");
      return ok("allowed");
    }

    if (step.confirmation_status !== "approved" || this.options.confirmationTimeoutMs <= 0) {
      return this.deny(
        step,
        tool.tool_id,
        action.risk_tier,
        "NOVA-SEC001",
        "confirmation_required",
        "Explicit confirmation is required before this action can execute.",
      );
    }

    this.logDecision(step, tool.tool_id, action.risk_tier, "allowed", "confirmed");
    return ok("allowed");
  }

  private deny(
    step: ExecutionStep,
    toolId: string,
    riskTier: string,
    errorCode: ErrorInfo["code"],
    reason: string,
    message: string,
    details?: Readonly<Record<string, string>>,
  ): Result<"allowed"> {
    this.logDecision(step, toolId, riskTier, "denied", reason, errorCode);
    return err({
      code: errorCode,
      message,
      retryable: false,
      ...(details === undefined ? {} : { details }),
    });
  }

  private logDecision(
    step: ExecutionStep,
    toolId: string,
    riskTier: string,
    decision: "allowed" | "denied",
    reason: string,
    errorCode?: string,
  ): void {
    this.logger?.info(
      "permission.decision",
      {
        tool_id: toolId,
        action_id: step.action_id,
        risk_tier: riskTier,
        decision,
        reason,
        ...(errorCode === undefined ? {} : { error_code: errorCode }),
      },
      step.correlation_id,
    );
  }
}

export class Executor {
  private readonly logger: StructuredLogger | undefined;

  constructor(
    private readonly permissionManager: PermissionManager,
    private readonly tools: ReadonlyMap<string, ToolRegistration>,
    private readonly resourceManager?: ResourceManager,
    logger?: StructuredLogger,
  ) {
    this.logger = logger;
  }

  async execute(step: ExecutionStep): Promise<Result<ExecutionResult>> {
    const tool = this.tools.get(step.resolved_tool_id);
    if (!tool) {
      return this.rejected(step, "NOVA-TL004", "tool_unavailable", false);
    }

    const permission = this.permissionManager.authorize(step, tool);
    if (!permission.ok) {
      this.logResult(step, "rejected", permission.error.code, permission.error.retryable);
      return permission;
    }

    const action = tool.actions[step.action_id];
    if (!action) {
      return this.rejected(step, "NOVA-TL004", "action_unavailable", false);
    }

    let lockGranted = false;
    if (this.resourceManager && action.risk_tier !== "read_only") {
      const lockResult = this.resourceManager.acquire(step.task_id, step.required_locks);
      if (!lockResult.ok) {
        this.logResult(step, "rejected", lockResult.error.code, lockResult.error.retryable);
        return lockResult;
      }
      if (lockResult.value.status === "queued") {
        return this.rejected(step, "NOVA-TL003", "resource_lock_queued", true);
      }
      lockGranted = true;
    }

    this.logger?.info(
      "executor.invocation",
      {
        step_id: step.step_id,
        task_id: step.task_id,
        tool_id: step.resolved_tool_id,
        action_id: step.action_id,
        risk_tier: step.risk_tier,
        execution_tier: step.execution_tier,
        required_lock_count: step.required_locks.length,
      },
      step.correlation_id,
    );

    try {
      const result = await action.execute(step.parameters);
      const executionResult = { ...result, step_id: step.step_id };
      this.logResult(step, executionResult.status, undefined, false, executionResult.evidence.type);
      return ok(executionResult);
    } catch (cause) {
      const errorCode = "NOVA-TL002";
      this.logResult(step, "failure", errorCode, action.idempotent);
      return err({
        code: errorCode,
        message: cause instanceof Error ? cause.message : "Tool invocation failed.",
        retryable: action.idempotent,
      });
    } finally {
      if (lockGranted) {
        this.resourceManager?.release(step.task_id);
      }
    }
  }

  private rejected(
    step: ExecutionStep,
    errorCode: ErrorInfo["code"],
    reason: string,
    retryable: boolean,
  ): Result<ExecutionResult> {
    this.logResult(step, "rejected", errorCode, retryable);
    return err({
      code: errorCode,
      message:
        errorCode === "NOVA-TL003"
          ? "Required resource locks are currently held by another task."
          : reason === "action_unavailable"
            ? "Requested tool action is unavailable."
            : "Requested tool is unavailable.",
      retryable,
      ...(errorCode === "NOVA-TL003" ? { details: { taskId: step.task_id } } : {}),
    });
  }

  private logResult(
    step: ExecutionStep,
    status: string,
    errorCode: string | undefined,
    retryable: boolean,
    evidenceType?: VerificationSignal,
  ): void {
    this.logger?.info(
      "executor.result",
      {
        step_id: step.step_id,
        tool_id: step.resolved_tool_id,
        action_id: step.action_id,
        status,
        retryable,
        ...(errorCode === undefined ? {} : { error_code: errorCode }),
        ...(evidenceType === undefined ? {} : { evidence_type: evidenceType }),
      },
      step.correlation_id,
    );
  }
}

/**
 * A minimal, structural view of `WorldModel` (`services/state/src/world-model.ts`)
 * — just the read accessors `Verifier` needs for secondary corroboration.
 * Declared locally rather than importing the concrete class so `orchestration.ts`
 * doesn't take on a hard dependency on `@nova/state` merely to type a parameter
 * — any object shaped like this (the real `WorldModel`, or a test double) works.
 */
export interface WorldModelSnapshotSource {
  runningApplications(): readonly { readonly id: string; readonly name: string }[];
  focus(): { readonly window_id?: string; readonly application_id?: string } | null;
}

export class Verifier {
  private readonly logger: StructuredLogger | undefined;
  private readonly toolRegistry: ToolRegistry | undefined;
  private readonly worldModel: WorldModelSnapshotSource | undefined;

  constructor(
    logger?: StructuredLogger,
    options?: { readonly toolRegistry?: ToolRegistry; readonly worldModel?: WorldModelSnapshotSource },
  ) {
    this.logger = logger;
    this.toolRegistry = options?.toolRegistry;
    this.worldModel = options?.worldModel;
  }

  verify(step: ExecutionStep, result: ExecutionResult): Result<VerificationVerdict> {
    if (step.step_id !== result.step_id) {
      this.logger?.warning(
        "verifier.rejected",
        { step_id: step.step_id, result_step_id: result.step_id, error_code: "NOVA-TL002" },
        step.correlation_id,
      );
      return err({
        code: "NOVA-TL002",
        message: "Executor result step_id does not match the planned step.",
        retryable: false,
      });
    }

    if (result.status === "failure" || result.status === "partial") {
      return this.record(step, {
        step_id: step.step_id,
        outcome: "failed",
        confidence: 1,
        verification_method: "ground_truth",
        explanation: "Ground-truth evidence confirms the step failed or only partially completed.",
      });
    }

    if (result.evidence.type === "none") {
      return this.record(step, {
        step_id: step.step_id,
        outcome: "unverified",
        confidence: 0,
        verification_method: "ground_truth",
        explanation: "No sufficient verification signal was provided.",
      });
    }

    // The tool itself declares which evidence type its actions actually
    // produce (RegisteredAction.verification_signal) — evidence of a
    // different type than declared is itself a signal something is wrong
    // (a misconfigured tool, or a result routed to the wrong verifier path),
    // not something to treat as valid just because it isn't literally "none".
    const declaration = this.lookupDeclaration(step);
    if (declaration && declaration.verification_signal !== result.evidence.type) {
      return this.record(step, {
        step_id: step.step_id,
        outcome: "unverified",
        confidence: 0.2,
        verification_method: "ground_truth",
        explanation: `Action '${step.action_id}' declares verification_signal '${declaration.verification_signal}' but evidence of type '${result.evidence.type}' was returned.`,
      });
    }

    const inspected = this.inspectEvidence(step, result.evidence);
    const corroborated = this.corroborateWithWorldModel(step, inspected);
    return this.record(step, {
      step_id: step.step_id,
      outcome: corroborated.outcome,
      confidence: corroborated.confidence,
      verification_method: corroborated.verification_method,
      explanation: corroborated.explanation,
    });
  }

  /**
   * Actually inspects `evidence.value` rather than only checking that
   * *some* non-"none" evidence was supplied — a nonzero exit code or a 5xx
   * API response reported alongside `status: "success"` is exactly the
   * false-success case this project's own verification principle
   * (`docs/03-runtime/verifier.md`: a false "success" is worse than a
   * visible failure) exists to catch, and the previous implementation
   * could not catch it because it never looked at `value` at all.
   */
  private inspectEvidence(
    step: ExecutionStep,
    evidence: ExecutionEvidence,
  ): { outcome: VerificationOutcome; confidence: number; explanation: string } {
    switch (evidence.type) {
      case "exit_code": {
        if (typeof evidence.value !== "number") {
          return {
            outcome: "unverified",
            confidence: 0.1,
            explanation: "exit_code evidence did not contain a numeric exit code.",
          };
        }
        if (evidence.value === 0) {
          return { outcome: "verified", confidence: 1, explanation: "Process exited with code 0." };
        }
        return {
          outcome: "failed",
          confidence: 1,
          explanation: `Process exited with non-zero code ${evidence.value}, contradicting a reported success.`,
        };
      }
      case "api_response": {
        const status = readStatusCode(evidence.value);
        if (status === undefined) {
          return {
            outcome: "unverified",
            confidence: 0.2,
            explanation: "api_response evidence did not contain a recognizable status code.",
          };
        }
        if (status >= 200 && status < 300) {
          return { outcome: "verified", confidence: 1, explanation: `API responded with status ${status}.` };
        }
        return {
          outcome: "failed",
          confidence: 1,
          explanation: `API responded with status ${status}, contradicting a reported success.`,
        };
      }
      case "file_hash": {
        if (typeof evidence.value !== "string" || evidence.value.length === 0) {
          return {
            outcome: "unverified",
            confidence: 0.1,
            explanation: "file_hash evidence did not contain a hash value.",
          };
        }
        const expected = step.parameters["expected_file_hash"];
        if (typeof expected === "string") {
          return expected === evidence.value
            ? { outcome: "verified", confidence: 1, explanation: "File hash matches the expected hash." }
            : {
                outcome: "failed",
                confidence: 1,
                explanation: "File hash does not match the expected hash — the file's actual content differs from what was planned.",
              };
        }
        // A hash was produced, but nothing declared what it should have been —
        // this confirms *a* file exists, not that it's the *right* one.
        return {
          outcome: "verified",
          confidence: 0.6,
          explanation: "A file hash was produced, but no expected_file_hash was declared to compare it against.",
        };
      }
      case "accessibility_state": {
        if (typeof evidence.value !== "object" || evidence.value === null) {
          return {
            outcome: "unverified",
            confidence: 0.1,
            explanation: "accessibility_state evidence did not contain a state object.",
          };
        }
        const expected = step.parameters["expected_state"];
        if (typeof expected === "object" && expected !== null) {
          const actual = evidence.value as Record<string, unknown>;
          const mismatches = Object.entries(expected as Record<string, unknown>).filter(
            ([key, value]) => actual[key] !== value,
          );
          return mismatches.length === 0
            ? { outcome: "verified", confidence: 1, explanation: "Accessibility state matches every expected field." }
            : {
                outcome: "failed",
                confidence: 1,
                explanation: `Accessibility state did not match ${mismatches.length} expected field(s): ${mismatches.map(([key]) => key).join(", ")}.`,
              };
        }
        return {
          outcome: "verified",
          confidence: 0.6,
          explanation: "An accessibility state snapshot was captured, but no expected_state was declared to compare it against.",
        };
      }
      default:
        return { outcome: "unverified", confidence: 0, explanation: "Unrecognized evidence type." };
    }
  }

  /**
   * A secondary corroboration pass, only for the execution tiers that are
   * inherently least trustworthy on their own (accessibility/vision/
   * keyboard_mouse — screenshot- or UI-tree-based interaction rather than a
   * direct API/process result). Never upgrades a ground-truth "failed" verdict,
   * and never invents a "verified" the primary inspection didn't already reach —
   * it only tempers confidence when the World Model's own independent view of
   * the world disagrees with what the step claims to have affected.
   */
  private corroborateWithWorldModel(
    step: ExecutionStep,
    primary: { outcome: VerificationOutcome; confidence: number; explanation: string },
  ): { outcome: VerificationOutcome; confidence: number; verification_method: "ground_truth" | "vision_secondary"; explanation: string } {
    const lowerTrustTier =
      step.execution_tier === "accessibility" ||
      step.execution_tier === "vision" ||
      step.execution_tier === "keyboard_mouse";
    if (!this.worldModel || !lowerTrustTier || primary.outcome !== "verified") {
      return { ...primary, verification_method: "ground_truth" };
    }

    const expectedApplication = step.parameters["expected_application_id"];
    if (typeof expectedApplication !== "string") {
      return { ...primary, verification_method: "ground_truth" };
    }
    const running = this.worldModel.runningApplications().some((app) => app.id === expectedApplication);
    if (running) {
      return {
        outcome: "verified",
        confidence: Math.min(1, primary.confidence + 0.1),
        verification_method: "vision_secondary",
        explanation: `${primary.explanation} Corroborated: '${expectedApplication}' is confirmed running by the World Model.`,
      };
    }
    return {
      outcome: "unverified",
      confidence: Math.min(primary.confidence, 0.4),
      verification_method: "vision_secondary",
      explanation: `${primary.explanation} However, the World Model does not show '${expectedApplication}' running — the primary evidence and observed world state disagree.`,
    };
  }

  private lookupDeclaration(step: ExecutionStep): { readonly verification_signal: string } | undefined {
    if (!this.toolRegistry) return undefined;
    const tool = this.toolRegistry.get(step.resolved_tool_id);
    if (!tool.ok) return undefined;
    return tool.value.supported_actions.find((action) => action.action_id === step.action_id);
  }

  private record(step: ExecutionStep, verdict: VerificationVerdict): Result<VerificationVerdict> {
    this.logger?.info(
      "verifier.outcome",
      {
        step_id: verdict.step_id,
        outcome: verdict.outcome,
        confidence: verdict.confidence,
        verification_method: verdict.verification_method,
      },
      step.correlation_id,
    );
    return ok(verdict);
  }
}

function readStatusCode(value: unknown): number | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const candidate = record["status"] ?? record["status_code"] ?? record["statusCode"];
  return typeof candidate === "number" ? candidate : undefined;
}

import { createMessage, type CommunicationBus, type Result } from "@nova/shared";
import type {
  ExecutionResult,
  ExecutionStep,
  Executor,
  Planner,
  VerificationVerdict,
  Verifier,
} from "./orchestration.js";
import type { TaskManager, TaskRecord } from "./task-manager.js";
import { computeExecutionGroups } from "./execution-scheduler.js";

export interface TaskCheckpointPersistence {
  append(record: TaskRecord, status: "Created" | "Valid"): Promise<Result<void>>;
}

export interface RuntimeTaskCoordinatorOptions {
  readonly tasks: TaskManager;
  readonly planner: Planner;
  readonly executor: Executor;
  readonly verifier: Verifier;
  readonly events: CommunicationBus;
  readonly persistence?: TaskCheckpointPersistence;
  readonly sourceService?: string;
  /** How many automatic in-flight replan attempts a failed step gets before the task is given up on and transitioned to Failed. Defaults to 2. This is a bounded, automatic correction loop distinct from `retry()`, which is the user-confirmed, outer "try the whole task again after it already failed" path. */
  readonly maxReplanAttempts?: number;
}

interface StepVerdictEntry {
  readonly step: ExecutionStep;
  readonly result: ExecutionResult;
  readonly verdict: VerificationVerdict;
}

function buildReplanGoal(
  originalGoal: string,
  failure: { readonly step: ExecutionStep; readonly reason: string },
  attempt: number,
): string {
  return [
    originalGoal,
    "",
    `[Automatic replan attempt ${attempt}: a previous attempt failed at action ` +
      `'${failure.step.action_id}' on tool '${failure.step.resolved_tool_id}' — ${failure.reason}. ` +
      "Produce a plan that achieves the original goal without repeating this failure; " +
      "prefer a genuinely different approach or tool over retrying the identical action.]",
  ].join("\n");
}

interface StepEntryOutcome {
  readonly kind: "entry";
  readonly entry: StepVerdictEntry;
}
interface StepFailureOutcome {
  readonly kind: "step_failure";
  readonly step: ExecutionStep;
  readonly reason: string;
  /** Present when the step *did* execute and get a verdict, just a "failed" one — still worth recording in the audit trail, distinct from an execution error, which never produced a verdict at all. */
  readonly entry?: StepVerdictEntry;
}
interface StepVerifierErrorOutcome {
  readonly kind: "verifier_error";
  readonly errorInfo: Readonly<Record<string, unknown>>;
}
type StepOutcome = StepEntryOutcome | StepFailureOutcome | StepVerifierErrorOutcome;

async function runStep(
  step: ExecutionStep,
  executor: Executor,
  verifier: Verifier,
): Promise<StepOutcome> {
  const execution = await executor.execute(step);
  if (!execution.ok) {
    return { kind: "step_failure", step, reason: `Execution error: ${execution.error.message}` };
  }
  const verdict = verifier.verify(step, execution.value);
  if (!verdict.ok) {
    return { kind: "verifier_error", errorInfo: { phase: "verification", error: verdict.error } };
  }
  const entry: StepVerdictEntry = { step, result: execution.value, verdict: verdict.value };
  if (verdict.value.outcome === "failed") {
    return { kind: "step_failure", step, reason: verdict.value.explanation, entry };
  }
  return { kind: "entry", entry };
}

export class RuntimeTaskCoordinator {
  private readonly sourceService: string;

  public constructor(private readonly options: RuntimeTaskCoordinatorOptions) {
    this.sourceService = options.sourceService ?? "runtime.task-coordinator";
  }

  public submit(input: {
    readonly goal: string;
    readonly correlation_id?: string;
    readonly task_id?: string;
  }): Result<TaskRecord> {
    const created = this.options.tasks.create(input);
    if (created.ok) void this.publish(created.value).catch(() => undefined);
    return created;
  }

  public async submitDurable(input: {
    readonly goal: string;
    readonly correlation_id?: string;
    readonly task_id?: string;
  }): Promise<Result<TaskRecord>> {
    const created = this.options.tasks.create(input);
    if (!created.ok) return created;
    const persisted = await this.persist(created.value, "Created");
    if (!persisted.ok) return persisted;
    await this.publish(created.value);
    return created;
  }

  public async retry(taskId: string, confirmed: boolean): Promise<Result<TaskRecord>> {
    if (!confirmed) {
      return {
        ok: false,
        error: {
          code: "NOVA-SEC001",
          message: "Retrying a task requires explicit confirmation.",
          retryable: false,
        },
      };
    }
    const transitioned = this.options.tasks.transition(taskId, "Retrying");
    if (!transitioned.ok) return transitioned;
    const persisted = await this.persist(transitioned.value, "Valid");
    if (!persisted.ok) return persisted;
    await this.publish(transitioned.value);
    return this.execute(taskId);
  }

  public async resumePaused(taskId: string, confirmed: boolean): Promise<Result<TaskRecord>> {
    if (!confirmed) {
      return {
        ok: false,
        error: {
          code: "NOVA-SEC001",
          message: "Resuming a paused task requires explicit confirmation.",
          retryable: false,
        },
      };
    }
    const current = this.options.tasks.get(taskId);
    if (!current.ok) return current;
    if (current.value.state !== "Paused") {
      return {
        ok: false,
        error: {
          code: "NOVA-TL002",
          message: "Only paused tasks can be resumed.",
          retryable: false,
          details: { taskId, state: current.value.state },
        },
      };
    }
    return this.execute(taskId);
  }

  public async confirmWaitingUser(taskId: string, confirmed: boolean): Promise<Result<TaskRecord>> {
    if (!confirmed) {
      return {
        ok: false,
        error: {
          code: "NOVA-SEC001",
          message: "Resolving a permission-blocked task requires explicit confirmation.",
          retryable: false,
        },
      };
    }
    const current = this.options.tasks.get(taskId);
    if (!current.ok) return current;
    if (current.value.state !== "WaitingUser") {
      return {
        ok: false,
        error: {
          code: "NOVA-TL002",
          message: "Only tasks waiting for user input can be resolved.",
          retryable: false,
          details: { taskId, state: current.value.state },
        },
      };
    }
    if (current.value.waiting_user_reason !== "permission_confirmation") {
      return {
        ok: false,
        error: {
          code: "NOVA-TL002",
          message: "Clarification-blocked tasks require new user input before replanning.",
          retryable: false,
          details: {
            taskId,
            waitingUserReason: current.value.waiting_user_reason ?? "unknown",
          },
        },
      };
    }
    const transitioned = this.options.tasks.transition(taskId, "Executing", "resumed");
    if (!transitioned.ok) return transitioned;
    const persisted = await this.persist(transitioned.value, "Valid");
    if (!persisted.ok) return persisted;
    await this.publish(transitioned.value);
    return transitioned;
  }

  public async denyWaitingUser(taskId: string, confirmed: boolean): Promise<Result<TaskRecord>> {
    if (!confirmed) {
      return {
        ok: false,
        error: {
          code: "NOVA-SEC001",
          message: "Denying a permission-blocked task requires explicit confirmation.",
          retryable: false,
        },
      };
    }
    const current = this.options.tasks.get(taskId);
    if (!current.ok) return current;
    if (current.value.state !== "WaitingUser") {
      return {
        ok: false,
        error: {
          code: "NOVA-TL002",
          message: "Only tasks waiting for user input can be denied.",
          retryable: false,
          details: { taskId, state: current.value.state },
        },
      };
    }
    if (current.value.waiting_user_reason !== "permission_confirmation") {
      return {
        ok: false,
        error: {
          code: "NOVA-TL002",
          message: "Clarification-blocked tasks require new user input before replanning.",
          retryable: false,
          details: {
            taskId,
            waitingUserReason: current.value.waiting_user_reason ?? "unknown",
          },
        },
      };
    }
    const transitioned = this.options.tasks.transition(taskId, "Cancelled", "denied");
    if (!transitioned.ok) return transitioned;
    const persisted = await this.persist(transitioned.value, "Valid");
    if (!persisted.ok) return persisted;
    await this.publish(transitioned.value);
    return transitioned;
  }

  public async execute(taskId: string): Promise<Result<TaskRecord>> {
    const current = this.options.tasks.get(taskId);
    if (!current.ok) return current;

    const planning = await this.transition(taskId, "Planning");
    if (!planning.ok) return planning;
    const plan = await this.options.planner.plan({
      task_id: planning.value.task_id,
      goal: planning.value.goal,
    });
    if (!plan.ok) return this.fail(taskId, { phase: "planning", error: plan.error });
    if (plan.value.length === 0) {
      return this.fail(taskId, {
        phase: "planning",
        error: { code: "NOVA-TL002", message: "Planner returned no executable steps." },
      });
    }

    const executing = await this.transition(taskId, "Executing");
    if (!executing.ok) return executing;

    // A Plan -> Execute -> Observe -> Replan loop, not a single sequential pass:
    // execution and verification are interleaved per step (not two separate
    // passes over the whole plan) specifically so a step that fails
    // verification stops the *next* step from ever running — the previous
    // implementation verified everything only after every step had already
    // executed, so a failed step never prevented the steps after it from
    // running. `auditLog` keeps every attempt, including ones a later replan
    // recovered from, for a transparent history; `finalAttemptVerdicts` is
    // reset per attempt and is what actually determines the task's outcome,
    // so a step that failed and was then successfully replanned around does
    // not still mark the whole task Failed.
    const maxReplanAttempts = this.options.maxReplanAttempts ?? 2;
    let remainingSteps = plan.value;
    let attempt = 0;
    const auditLog: StepVerdictEntry[] = [];
    let finalAttemptVerdicts: StepVerdictEntry[] = [];

    while (true) {
      finalAttemptVerdicts = [];
      let stepFailure: { readonly step: ExecutionStep; readonly reason: string } | undefined;

      const groups = computeExecutionGroups(remainingSteps);
      if (!groups.ok) return this.fail(taskId, { phase: "scheduling", error: groups.error });

      groupLoop: for (const group of groups.value) {
        // Independent steps within a group run concurrently; a structural
        // Verifier error (as opposed to a step failing verification) is still
        // an immediate hard stop for the whole task, matching the previous
        // sequential behavior — it means the Verifier itself is broken, not
        // that this one step didn't pan out.
        const settled = await Promise.all(
          group.map((step) => runStep(step, this.options.executor, this.options.verifier)),
        );

        const verifierError = settled.find(
          (outcome): outcome is StepVerifierErrorOutcome => outcome.kind === "verifier_error",
        );
        if (verifierError) return this.fail(taskId, verifierError.errorInfo);

        for (const outcome of settled) {
          const entry =
            outcome.kind === "entry"
              ? outcome.entry
              : outcome.kind === "step_failure"
                ? outcome.entry
                : undefined;
          if (entry) {
            auditLog.push(entry);
            finalAttemptVerdicts.push(entry);
          }
        }

        const failure = settled.find(
          (outcome): outcome is StepFailureOutcome => outcome.kind === "step_failure",
        );
        if (failure) {
          stepFailure = { step: failure.step, reason: failure.reason };
          break groupLoop;
        }
      }

      if (!stepFailure) break;

      attempt += 1;
      if (attempt > maxReplanAttempts) {
        for (const entry of auditLog) {
          const history = await this.appendStepHistory(taskId, entry);
          if (!history.ok) return history;
        }
        return this.fail(taskId, {
          phase: "execution",
          step: stepFailure.step,
          error: {
            code: "NOVA-TL002",
            message: `Exhausted ${maxReplanAttempts} replan attempt(s): ${stepFailure.reason}`,
          },
        });
      }

      const replanned = await this.options.planner.plan({
        task_id: planning.value.task_id,
        goal: buildReplanGoal(planning.value.goal, stepFailure, attempt),
      });
      if (!replanned.ok || replanned.value.length === 0) {
        for (const entry of auditLog) {
          const history = await this.appendStepHistory(taskId, entry);
          if (!history.ok) return history;
        }
        return this.fail(taskId, {
          phase: "replanning",
          step: stepFailure.step,
          error: replanned.ok
            ? { code: "NOVA-TL002", message: "Replanner returned no executable steps." }
            : replanned.error,
        });
      }
      remainingSteps = replanned.value;
    }

    const verifying = await this.transition(taskId, "Verifying");
    if (!verifying.ok) return verifying;

    for (const entry of auditLog) {
      const history = await this.appendStepHistory(taskId, entry);
      if (!history.ok) return history;
    }
    const outcome = finalAttemptVerdicts.some((entry) => entry.verdict.outcome === "failed")
      ? "Failed"
      : finalAttemptVerdicts.some((entry) => entry.verdict.outcome === "unverified")
        ? "Unverified"
        : "Completed";
    return this.transition(taskId, outcome);
  }

  private async fail(
    taskId: string,
    history: Readonly<Record<string, unknown>>,
  ): Promise<Result<TaskRecord>> {
    const appended = await this.appendStepHistory(taskId, history);
    if (!appended.ok) return appended;
    return this.transition(taskId, "Failed");
  }

  private async transition(
    taskId: string,
    target: "Planning" | "Executing" | "Verifying" | "Completed" | "Unverified" | "Failed",
  ): Promise<Result<TaskRecord>> {
    const transitioned = this.options.tasks.transition(taskId, target);
    if (!transitioned.ok) return transitioned;
    const persisted = await this.persist(transitioned.value, "Valid");
    if (!persisted.ok) return persisted;
    await this.publish(transitioned.value);
    return transitioned;
  }

  private async appendStepHistory(taskId: string, step: unknown): Promise<Result<TaskRecord>> {
    const appended = this.options.tasks.appendStepHistory(taskId, step);
    if (!appended.ok) return appended;
    const persisted = await this.persist(appended.value, "Valid");
    if (!persisted.ok) return persisted;
    return appended;
  }

  private async persist(record: TaskRecord, status: "Created" | "Valid"): Promise<Result<void>> {
    if (!this.options.persistence) return { ok: true, value: undefined };
    return this.options.persistence.append(record, status);
  }

  private async publish(record: TaskRecord): Promise<void> {
    const result = await this.options.events.publish(
      createMessage({
        topic: "task.progress",
        schema_version: "1.0.0",
        correlation_id: record.correlation_id,
        source_service: this.sourceService,
        payload: {
          task_id: record.task_id,
          goal: record.goal,
          state: record.state,
          retry_count: record.retry_count,
          updated_at: record.updated_at,
        },
      }),
    );
    if (!result.ok) throw new Error(result.error.message);
  }
}

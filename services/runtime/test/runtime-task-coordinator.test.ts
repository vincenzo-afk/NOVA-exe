import { describe, expect, it, vi } from "vitest";
import { InMemoryCommunicationBus } from "@nova/shared";
import {
  Executor,
  PermissionManager,
  Planner,
  Verifier,
  type ToolRegistration,
} from "../src/orchestration.js";
import { TaskManager } from "../src/task-manager.js";
import { RuntimeTaskCoordinator } from "../src/runtime-task-coordinator.js";

const step = {
  step_id: "step-1",
  task_id: "placeholder",
  correlation_id: "00000000-0000-4000-8000-000000000001",
  capability_id: "capability.test",
  resolved_tool_id: "tool.test",
  action_id: "run",
  parameters: { value: 42 },
  risk_tier: "read_only" as const,
  execution_tier: "internal_function" as const,
  required_locks: [],
  timeout_ms: 1_000,
  confirmation_status: "not_required" as const,
};

const tool: ToolRegistration = {
  tool_id: "tool.test",
  deterministic: true,
  actions: {
    run: {
      risk_tier: "read_only",
      verification_signal: "api_response",
      idempotent: true,
      execute: vi.fn(async (parameters) => ({
        status: "success" as const,
        evidence: { type: "api_response" as const, value: { status: 200, echoed: parameters.value } },
        affected_resources: [],
      })),
    },
  },
};

describe("RuntimeTaskCoordinator", () => {
  it("persists task checkpoints before returning and after lifecycle mutations", async () => {
    const checkpoints: Array<{ state: string; status: string }> = [];
    const persistence = {
      append: async (record: { state: string }, status: string) => {
        checkpoints.push({ state: record.state, status });
        return { ok: true as const, value: undefined };
      },
    };
    const tasks = new TaskManager();
    const coordinator = new RuntimeTaskCoordinator({
      tasks,
      planner: new Planner({ deterministic: new Map() }),
      executor: new Executor(
        new PermissionManager({ allowedToolIds: new Set(), confirmationTimeoutMs: 30_000 }),
        new Map(),
      ),
      verifier: new Verifier(),
      events: new InMemoryCommunicationBus(),
      persistence,
    });

    const submitted = await coordinator.submitDurable({ goal: "durable task" });

    expect(submitted).toMatchObject({ ok: true, value: { state: "Created" } });
    expect(checkpoints).toEqual([{ state: "Created", status: "Created" }]);
  });

  it("executes a deterministic task through planning, permission, execution, and verification", async () => {
    const bus = new InMemoryCommunicationBus();
    const events: unknown[] = [];
    bus.subscribe("task.progress", async (message) => {
      events.push(message);
    });
    const tasks = new TaskManager();
    const coordinator = new RuntimeTaskCoordinator({
      tasks,
      planner: new Planner({ deterministic: new Map([["run test", step]]) }),
      executor: new Executor(
        new PermissionManager({
          allowedToolIds: new Set([tool.tool_id]),
          confirmationTimeoutMs: 30_000,
        }),
        new Map([[tool.tool_id, tool]]),
      ),
      verifier: new Verifier(),
      events: bus,
    });

    const submitted = coordinator.submit({ goal: "run test", correlation_id: step.correlation_id });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;

    const completed = await coordinator.execute(submitted.value.task_id);

    expect(completed).toMatchObject({
      ok: true,
      value: { state: "Completed", step_history: [{ verdict: { outcome: "verified" } }] },
    });
    expect(tool.actions.run.execute).toHaveBeenCalledWith({ value: 42 });
    expect(events.map((event) => (event as { payload: { state: string } }).payload.state)).toEqual([
      "Created",
      "Planning",
      "Executing",
      "Verifying",
      "Completed",
    ]);
  });

  it("fails safely when the permission boundary denies the planned tool", async () => {
    const tasks = new TaskManager();
    const deniedExecute = vi.fn(tool.actions.run.execute);
    const deniedTool: ToolRegistration = {
      ...tool,
      actions: { run: { ...tool.actions.run, execute: deniedExecute } },
    };
    const coordinator = new RuntimeTaskCoordinator({
      tasks,
      planner: new Planner({ deterministic: new Map([["denied", step]]) }),
      executor: new Executor(
        new PermissionManager({ allowedToolIds: new Set(), confirmationTimeoutMs: 30_000 }),
        new Map([[deniedTool.tool_id, deniedTool]]),
      ),
      verifier: new Verifier(),
      events: new InMemoryCommunicationBus(),
    });

    const submitted = coordinator.submit({ goal: "denied" });
    if (!submitted.ok) throw new Error("Task submission failed.");
    const result = await coordinator.execute(submitted.value.task_id);

    expect(result).toMatchObject({ ok: true, value: { state: "Failed" } });
    expect(deniedExecute).not.toHaveBeenCalled();
  });

  it("requires explicit confirmation before retrying and then reuses the authoritative execution path", async () => {
    const tasks = new TaskManager();
    const coordinator = new RuntimeTaskCoordinator({
      tasks,
      planner: new Planner({ deterministic: new Map([["retry me", step]]) }),
      executor: new Executor(
        new PermissionManager({
          allowedToolIds: new Set([tool.tool_id]),
          confirmationTimeoutMs: 30_000,
        }),
        new Map([[tool.tool_id, tool]]),
      ),
      verifier: new Verifier(),
      events: new InMemoryCommunicationBus(),
    });
    const submitted = tasks.create({ goal: "retry me" });
    if (!submitted.ok) throw new Error("Task creation failed.");
    expect(tasks.transition(submitted.value.task_id, "Planning")).toMatchObject({ ok: true });
    expect(tasks.transition(submitted.value.task_id, "Failed", "retryable failure")).toMatchObject({
      ok: true,
    });

    expect(await coordinator.retry(submitted.value.task_id, false)).toMatchObject({
      ok: false,
      error: { code: "NOVA-SEC001" },
    });
    const retried = await coordinator.retry(submitted.value.task_id, true);

    expect(retried).toMatchObject({
      ok: true,
      value: { state: "Completed", retry_count: 1 },
    });
  });

  it("requires explicit confirmation before resuming a paused task", async () => {
    const tasks = new TaskManager();
    const coordinator = new RuntimeTaskCoordinator({
      tasks,
      planner: new Planner({ deterministic: new Map([["resume me", step]]) }),
      executor: new Executor(
        new PermissionManager({
          allowedToolIds: new Set([tool.tool_id]),
          confirmationTimeoutMs: 30_000,
        }),
        new Map([[tool.tool_id, tool]]),
      ),
      verifier: new Verifier(),
      events: new InMemoryCommunicationBus(),
    });
    const submitted = tasks.create({ goal: "resume me" });
    if (!submitted.ok) throw new Error("Task creation failed.");
    expect(tasks.transition(submitted.value.task_id, "Paused")).toMatchObject({ ok: true });

    expect(await coordinator.resumePaused(submitted.value.task_id, false)).toMatchObject({
      ok: false,
      error: { code: "NOVA-SEC001" },
    });
    const resumed = await coordinator.resumePaused(submitted.value.task_id, true);

    expect(resumed).toMatchObject({ ok: true, value: { state: "Completed", retry_count: 0 } });
  });

  it("resolves permission-blocked WaitingUser tasks only with explicit confirmation", async () => {
    const tasks = new TaskManager();
    const coordinator = new RuntimeTaskCoordinator({
      tasks,
      planner: new Planner({ deterministic: new Map() }),
      executor: new Executor(
        new PermissionManager({ allowedToolIds: new Set(), confirmationTimeoutMs: 30_000 }),
        new Map(),
      ),
      verifier: new Verifier(),
      events: new InMemoryCommunicationBus(),
    });
    const submitted = tasks.create({ goal: "permission-gated" });
    if (!submitted.ok) throw new Error("Task creation failed.");
    expect(tasks.transition(submitted.value.task_id, "Paused")).toMatchObject({ ok: true });
    expect(
      tasks.transition(submitted.value.task_id, "WaitingUser", "permission_confirmation"),
    ).toMatchObject({ ok: true });

    expect(await coordinator.confirmWaitingUser(submitted.value.task_id, false)).toMatchObject({
      ok: false,
      error: { code: "NOVA-SEC001" },
    });
    expect(await coordinator.confirmWaitingUser(submitted.value.task_id, true)).toMatchObject({
      ok: true,
      value: { state: "Executing" },
    });

    const clarification = tasks.create({ goal: "clarification-gated" });
    if (!clarification.ok) throw new Error("Clarification task creation failed.");
    expect(tasks.transition(clarification.value.task_id, "Planning")).toMatchObject({ ok: true });
    expect(
      tasks.transition(clarification.value.task_id, "WaitingUser", "clarification_requested"),
    ).toMatchObject({ ok: true });
    expect(await coordinator.confirmWaitingUser(clarification.value.task_id, true)).toMatchObject({
      ok: false,
      error: { code: "NOVA-TL002" },
    });
  });

  it("denies permission-blocked WaitingUser tasks only with explicit confirmation", async () => {
    const tasks = new TaskManager();
    const coordinator = new RuntimeTaskCoordinator({
      tasks,
      planner: new Planner({ deterministic: new Map() }),
      executor: new Executor(
        new PermissionManager({ allowedToolIds: new Set(), confirmationTimeoutMs: 30_000 }),
        new Map(),
      ),
      verifier: new Verifier(),
      events: new InMemoryCommunicationBus(),
    });
    const submitted = tasks.create({ goal: "deny permission" });
    if (!submitted.ok) throw new Error("Task creation failed.");
    expect(tasks.transition(submitted.value.task_id, "Paused")).toMatchObject({ ok: true });
    expect(
      tasks.transition(submitted.value.task_id, "WaitingUser", "permission_confirmation"),
    ).toMatchObject({ ok: true });

    expect(await coordinator.denyWaitingUser(submitted.value.task_id, false)).toMatchObject({
      ok: false,
      error: { code: "NOVA-SEC001" },
    });
    expect(await coordinator.denyWaitingUser(submitted.value.task_id, true)).toMatchObject({
      ok: true,
      value: { state: "Cancelled", reason: "denied" },
    });

    const clarification = tasks.create({ goal: "do not deny clarification" });
    if (!clarification.ok) throw new Error("Clarification task creation failed.");
    expect(tasks.transition(clarification.value.task_id, "Planning")).toMatchObject({ ok: true });
    expect(
      tasks.transition(clarification.value.task_id, "WaitingUser", "clarification_requested"),
    ).toMatchObject({ ok: true });
    expect(await coordinator.denyWaitingUser(clarification.value.task_id, true)).toMatchObject({
      ok: false,
      error: { code: "NOVA-TL002" },
    });
  });

  it("never reports Completed when execution has no verification evidence", async () => {
    const tasks = new TaskManager();
    const coordinator = new RuntimeTaskCoordinator({
      tasks,
      planner: new Planner({ deterministic: new Map([["unverified", step]]) }),
      executor: new Executor(
        new PermissionManager({
          allowedToolIds: new Set([tool.tool_id]),
          confirmationTimeoutMs: 30_000,
        }),
        new Map([
          [
            tool.tool_id,
            {
              ...tool,
              actions: {
                run: {
                  ...tool.actions.run,
                  execute: async () => ({
                    status: "success" as const,
                    evidence: { type: "none" as const, value: null },
                    affected_resources: [],
                  }),
                },
              },
            },
          ],
        ]),
      ),
      verifier: new Verifier(),
      events: new InMemoryCommunicationBus(),
    });

    const submitted = coordinator.submit({ goal: "unverified" });
    if (!submitted.ok) throw new Error("Task submission failed.");
    const result = await coordinator.execute(submitted.value.task_id);

    expect(result).toMatchObject({ ok: true, value: { state: "Unverified" } });
  });

  it("automatically replans around a failed step and completes via an alternative plan", async () => {
    const tasks = new TaskManager();
    const failingTool: ToolRegistration = {
      tool_id: "tool.flaky",
      deterministic: true,
      actions: {
        run: {
          risk_tier: "read_only",
          verification_signal: "exit_code",
          idempotent: true,
          execute: vi.fn(async () => ({
            status: "success" as const,
            evidence: { type: "exit_code" as const, value: 1 },
            affected_resources: [],
          })),
        },
      },
    };
    const failingStep = { ...step, resolved_tool_id: failingTool.tool_id };
    const recoveryStep = { ...step, step_id: "step-2", resolved_tool_id: tool.tool_id };

    const coordinator = new RuntimeTaskCoordinator({
      tasks,
      planner: new Planner({
        deterministic: new Map([["flaky then recover", failingStep]]),
        llmPlanner: async (goal) => (goal.includes("Automatic replan attempt 1") ? [recoveryStep] : []),
      }),
      executor: new Executor(
        new PermissionManager({
          allowedToolIds: new Set([failingTool.tool_id, tool.tool_id]),
          confirmationTimeoutMs: 30_000,
        }),
        new Map([
          [failingTool.tool_id, failingTool],
          [tool.tool_id, tool],
        ]),
      ),
      verifier: new Verifier(),
      events: new InMemoryCommunicationBus(),
    });

    const submitted = coordinator.submit({ goal: "flaky then recover" });
    if (!submitted.ok) throw new Error("Task submission failed.");
    const result = await coordinator.execute(submitted.value.task_id);

    expect(result).toMatchObject({ ok: true, value: { state: "Completed" } });
    if (!result.ok) return;
    // The audit trail records both the failed first attempt and the
    // successful recovery — nothing about a later successful replan erases
    // the fact an earlier attempt failed.
    expect(result.value.step_history).toHaveLength(2);
    expect(result.value.step_history[0]).toMatchObject({ verdict: { outcome: "failed" } });
    expect(result.value.step_history[1]).toMatchObject({ verdict: { outcome: "verified" } });
    expect(failingTool.actions.run.execute).toHaveBeenCalledTimes(1);
  });

  it("fails the task once replan attempts are exhausted, never retrying forever", async () => {
    const tasks = new TaskManager();
    const alwaysFailingExecute = vi.fn(async () => ({
      status: "success" as const,
      evidence: { type: "exit_code" as const, value: 1 },
      affected_resources: [],
    }));
    const failingTool: ToolRegistration = {
      tool_id: "tool.always-flaky",
      deterministic: true,
      actions: {
        run: { risk_tier: "read_only", verification_signal: "exit_code", idempotent: true, execute: alwaysFailingExecute },
      },
    };
    const failingStep = { ...step, resolved_tool_id: failingTool.tool_id };
    let llmPlannerCalls = 0;

    const coordinator = new RuntimeTaskCoordinator({
      tasks,
      planner: new Planner({
        deterministic: new Map([["never recovers", failingStep]]),
        llmPlanner: async () => {
          llmPlannerCalls += 1;
          return [failingStep];
        },
      }),
      executor: new Executor(
        new PermissionManager({ allowedToolIds: new Set([failingTool.tool_id]), confirmationTimeoutMs: 30_000 }),
        new Map([[failingTool.tool_id, failingTool]]),
      ),
      verifier: new Verifier(),
      events: new InMemoryCommunicationBus(),
      maxReplanAttempts: 2,
    });

    const submitted = coordinator.submit({ goal: "never recovers" });
    if (!submitted.ok) throw new Error("Task submission failed.");
    const result = await coordinator.execute(submitted.value.task_id);

    expect(result).toMatchObject({ ok: true, value: { state: "Failed" } });
    // Original attempt + 2 replans = 3 total execution attempts, then it gives up.
    expect(alwaysFailingExecute).toHaveBeenCalledTimes(3);
    expect(llmPlannerCalls).toBe(2);
  });

  it("executes independent steps concurrently instead of strictly one-at-a-time", async () => {
    const tasks = new TaskManager();
    const events: string[] = [];
    const makeTool = (id: string, delayMs: number): ToolRegistration => ({
      tool_id: id,
      deterministic: true,
      actions: {
        run: {
          risk_tier: "read_only",
          verification_signal: "exit_code",
          idempotent: true,
          execute: async () => {
            events.push(`${id}:start`);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            events.push(`${id}:end`);
            return { status: "success" as const, evidence: { type: "exit_code" as const, value: 0 }, affected_resources: [] };
          },
        },
      },
    });
    const toolA = makeTool("tool.a", 20);
    const toolB = makeTool("tool.b", 5);
    const stepA = { ...step, step_id: "step-a", resolved_tool_id: toolA.tool_id };
    const stepB = { ...step, step_id: "step-b", resolved_tool_id: toolB.tool_id };

    // Two independent steps with no depends_on between them; an llmPlanner
    // (rather than the deterministic single-goal map) is the simplest way to
    // hand the coordinator a genuine two-step, no-dependency plan directly.
    const parallelPlanner = new Planner({ deterministic: new Map(), llmPlanner: async () => [stepA, stepB] });
    const parallelCoordinator = new RuntimeTaskCoordinator({
      tasks,
      planner: parallelPlanner,
      executor: new Executor(
        new PermissionManager({ allowedToolIds: new Set([toolA.tool_id, toolB.tool_id]), confirmationTimeoutMs: 30_000 }),
        new Map([
          [toolA.tool_id, toolA],
          [toolB.tool_id, toolB],
        ]),
      ),
      verifier: new Verifier(),
      events: new InMemoryCommunicationBus(),
    });

    const submitted = parallelCoordinator.submit({ goal: "run both" });
    if (!submitted.ok) throw new Error("Task submission failed.");
    const result = await parallelCoordinator.execute(submitted.value.task_id);

    expect(result).toMatchObject({ ok: true, value: { state: "Completed" } });
    // If steps ran strictly sequentially, tool.a (the slower one, started
    // first in list order) would fully finish before tool.b ever started.
    // Concurrent execution means tool.b's start (and, given its shorter
    // delay, its end) lands before tool.a's end.
    expect(events.indexOf("tool.b:start")).toBeLessThan(events.indexOf("tool.a:end"));
  });
});

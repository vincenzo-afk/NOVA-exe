import { describe, expect, it, vi } from "vitest";
import { InMemoryCommunicationBus } from "@nova/shared";

import { Planner, Verifier, type ToolRegistration } from "../src/orchestration.js";
import { TaskManager } from "../src/task-manager.js";
import {
  MultiAgentCoordinator,
  type AgentBranchSpec,
  type AgentEventBus,
} from "../src/multi-agent.js";
import { AgentMessageBus } from "../src/agent-message-bus.js";

function buildStep(
  toolId: string,
  actionId = "run",
  parameters: Readonly<Record<string, unknown>> = {},
) {
  return {
    step_id: `${toolId}-${actionId}-step`,
    task_id: "placeholder",
    correlation_id: "00000000-0000-4000-8000-000000000001",
    capability_id: `capability.${toolId}`,
    resolved_tool_id: toolId,
    action_id: actionId,
    parameters,
    risk_tier: "read_only" as const,
    execution_tier: "internal_function" as const,
    required_locks: [],
    timeout_ms: 5_000,
    confirmation_status: "not_required" as const,
  };
}

function successTool(
  toolId: string,
  execute?: ToolRegistration["actions"]["run"]["execute"],
): ToolRegistration {
  return {
    tool_id: toolId,
    deterministic: true,
    actions: {
      run: {
        risk_tier: "read_only",
        verification_signal: "exit_code",
        idempotent: true,
        execute:
          execute ??
          (async () => ({
            status: "success" as const,
            evidence: { type: "exit_code" as const, value: 0 },
            affected_resources: [],
          })),
      },
    },
  };
}

function buildCoordinator(
  deterministic: ReadonlyMap<string, ReturnType<typeof buildStep>>,
  tools: ReadonlyMap<string, ToolRegistration>,
  bus: AgentEventBus,
) {
  return new MultiAgentCoordinator({
    bus,
    tasks: new TaskManager(),
    planner: new Planner({ deterministic: new Map(deterministic) }),
    verifier: new Verifier(),
    tools,
    events: new InMemoryCommunicationBus(),
  });
}

describe("MultiAgentCoordinator", () => {
  it("runs genuinely independent branches, each through its own real plan/execute/verify cycle", async () => {
    const bus: AgentEventBus = { publish: vi.fn(async () => undefined) };
    const tools = new Map([
      ["tool.research", successTool("tool.research")],
      ["tool.refactor", successTool("tool.refactor")],
    ]);
    const coordinator = buildCoordinator(
      new Map([
        ["research the topic", buildStep("tool.research")],
        ["refactor the module", buildStep("tool.refactor")],
      ]),
      tools,
      bus,
    );
    const branches: AgentBranchSpec[] = [
      {
        branch_id: "research",
        role: "researcher",
        goal: "research the topic",
        permission_scope: new Set(["tool.research"]),
      },
      {
        branch_id: "refactor",
        role: "engineer",
        goal: "refactor the module",
        permission_scope: new Set(["tool.refactor"]),
      },
    ];

    const result = await coordinator.run(
      "parent-1",
      branches,
      new Set(["tool.research", "tool.refactor"]),
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        parent_task_id: "parent-1",
        status: "completed",
        branches: [
          {
            branch_id: "research",
            role: "researcher",
            status: "completed",
            task_state: "Completed",
          },
          { branch_id: "refactor", role: "engineer", status: "completed", task_state: "Completed" },
        ],
      },
    });
    expect(bus.publish).toHaveBeenCalled();
  });

  it("never allows a branch to exceed the parent permission scope, and never runs any branch if one does", async () => {
    const bus: AgentEventBus = { publish: vi.fn(async () => undefined) };
    const execute = vi.fn(async () => ({
      status: "success" as const,
      evidence: { type: "exit_code" as const, value: 0 },
      affected_resources: [],
    }));
    const tools = new Map([["tool.admin", successTool("tool.admin", execute)]]);
    const coordinator = buildCoordinator(
      new Map([["delete everything", buildStep("tool.admin")]]),
      tools,
      bus,
    );
    const branches: AgentBranchSpec[] = [
      {
        branch_id: "outside",
        goal: "delete everything",
        permission_scope: new Set(["tool.admin"]),
      },
    ];

    const result = await coordinator.run("parent-2", branches, new Set(["tool.research"]));

    expect(result).toMatchObject({ ok: false, error: { code: "NOVA-SEC001" } });
    expect(execute).not.toHaveBeenCalled();
    expect(bus.publish).not.toHaveBeenCalled();
  });

  it("rejects duplicate branch_ids within one run", async () => {
    const bus: AgentEventBus = { publish: vi.fn(async () => undefined) };
    const tools = new Map([["tool.a", successTool("tool.a")]]);
    const coordinator = buildCoordinator(new Map([["do it", buildStep("tool.a")]]), tools, bus);
    const branches: AgentBranchSpec[] = [
      { branch_id: "dup", goal: "do it", permission_scope: new Set(["tool.a"]) },
      { branch_id: "dup", goal: "do it", permission_scope: new Set(["tool.a"]) },
    ];

    const result = await coordinator.run("parent-dup", branches, new Set(["tool.a"]));

    expect(result).toMatchObject({ ok: false, error: { code: "NOVA-SEC001" } });
  });

  it("reports partial status while preserving each branch's own real outcome", async () => {
    const bus: AgentEventBus = { publish: vi.fn(async () => undefined) };
    const failingExecute = async () => ({
      status: "success" as const,
      evidence: { type: "exit_code" as const, value: 1 }, // non-zero — the real Verifier fails this, not a mock
      affected_resources: [],
    });
    const tools = new Map([
      ["tool.fail", successTool("tool.fail", failingExecute)],
      ["tool.ok", successTool("tool.ok")],
    ]);
    const coordinator = buildCoordinator(
      new Map([
        ["fail this", buildStep("tool.fail")],
        ["succeed at this", buildStep("tool.ok")],
      ]),
      tools,
      bus,
    );
    const branches: AgentBranchSpec[] = [
      { branch_id: "fail", goal: "fail this", permission_scope: new Set(["tool.fail"]) },
      { branch_id: "ok", goal: "succeed at this", permission_scope: new Set(["tool.ok"]) },
    ];

    const result = await coordinator.run("parent-3", branches, new Set(["tool.fail", "tool.ok"]));

    expect(result).toMatchObject({
      ok: true,
      value: {
        status: "partial",
        branches: [
          { branch_id: "fail", status: "failed" },
          { branch_id: "ok", status: "completed" },
        ],
      },
    });
  });

  it("lets a branch genuinely message another branch through the always-available messaging tool", async () => {
    const bus: AgentEventBus = { publish: vi.fn(async () => undefined) };
    const tools = new Map([["tool.noop", successTool("tool.noop")]]);
    // permission_scope intentionally never lists "nova.agent-messaging" for either branch —
    // it must still work, since coordination shouldn't require opting in to being coordinated.
    const coordinator = buildCoordinator(
      new Map([
        [
          "send hello to bob",
          buildStep("nova.agent-messaging", "send", { to_branch_id: "bob", content: "hello" }),
        ],
        ["wait for messages", buildStep("tool.noop")],
      ]),
      tools,
      bus,
    );
    const branches: AgentBranchSpec[] = [
      { branch_id: "alice", goal: "send hello to bob", permission_scope: new Set() },
      // bob's own goal doesn't touch messaging — it exists so "bob" is a
      // registered recipient the AgentMessageBus (seeded from this run's
      // full branch list) actually knows about.
      { branch_id: "bob", goal: "wait for messages", permission_scope: new Set(["tool.noop"]) },
    ];

    const result = await coordinator.run("parent-msg", branches, new Set(["tool.noop"]));

    expect(result).toMatchObject({
      ok: true,
      value: {
        status: "completed",
        branches: [
          { branch_id: "alice", status: "completed" },
          { branch_id: "bob", status: "completed" },
        ],
      },
    });
  });
});

describe("AgentMessageBus", () => {
  it("delivers a message only to its intended recipient and drains it on receive", () => {
    const bus = new AgentMessageBus(["a", "b"]);

    const sent = bus.send("a", "b", "hello from a");

    expect(sent.ok).toBe(true);
    expect(bus.peek("a")).toEqual([]);
    expect(bus.receive("b")).toMatchObject([
      { from_branch_id: "a", to_branch_id: "b", content: "hello from a" },
    ]);
    expect(bus.receive("b")).toEqual([]); // drained
  });

  it("rejects sending to a branch that isn't part of the run", () => {
    const bus = new AgentMessageBus(["a"]);

    const result = bus.send("a", "unknown", "hi");

    expect(result).toMatchObject({ ok: false, error: { code: "NOVA-TL003" } });
  });
});

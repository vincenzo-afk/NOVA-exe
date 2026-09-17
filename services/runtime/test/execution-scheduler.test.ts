/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, expect, it } from "vitest";

import { computeExecutionGroups } from "../src/execution-scheduler.js";
import type { ExecutionStep } from "../src/orchestration.js";

function step(overrides: Partial<ExecutionStep> & { step_id: string }): ExecutionStep {
  return {
    task_id: "task-1",
    correlation_id: "00000000-0000-4000-8000-000000000001",
    capability_id: "capability.test",
    resolved_tool_id: "tool.test",
    action_id: "run",
    parameters: {},
    risk_tier: "read_only",
    execution_tier: "internal_function",
    required_locks: [],
    timeout_ms: 1_000,
    confirmation_status: "not_required",
    ...overrides,
  };
}

describe("computeExecutionGroups", () => {
  it("puts independent steps with no declared dependencies in a single concurrent group", () => {
    const result = computeExecutionGroups([
      step({ step_id: "a" }),
      step({ step_id: "b" }),
      step({ step_id: "c" }),
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]!.map((s) => s.step_id).sort()).toEqual(["a", "b", "c"]);
  });

  it("orders steps into sequential groups when they declare depends_on", () => {
    const result = computeExecutionGroups([
      step({ step_id: "a" }),
      step({ step_id: "b", depends_on: ["a"] }),
      step({ step_id: "c", depends_on: ["b"] }),
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((group) => group.map((s) => s.step_id))).toEqual([["a"], ["b"], ["c"]]);
  });

  it("runs a fan-out (one step unblocking several independent ones) concurrently", () => {
    const result = computeExecutionGroups([
      step({ step_id: "root" }),
      step({ step_id: "leaf-1", depends_on: ["root"] }),
      step({ step_id: "leaf-2", depends_on: ["root"] }),
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    expect(result.value[0]!.map((s) => s.step_id)).toEqual(["root"]);
    expect(result.value[1]!.map((s) => s.step_id).sort()).toEqual(["leaf-1", "leaf-2"]);
  });

  it("never places two lock-conflicting steps in the same group even with no declared dependency between them", () => {
    const result = computeExecutionGroups([
      step({ step_id: "a", required_locks: ["file:/report.txt"] }),
      step({ step_id: "b", required_locks: ["file:/report.txt"] }),
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    const allIds = result.value.flatMap((group) => group.map((s) => s.step_id));
    expect(allIds.sort()).toEqual(["a", "b"]);
  });

  it("allows steps with different locks to run in the same group", () => {
    const result = computeExecutionGroups([
      step({ step_id: "a", required_locks: ["file:/a.txt"] }),
      step({ step_id: "b", required_locks: ["file:/b.txt"] }),
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
  });

  it("rejects a plan with a dependency cycle instead of silently dropping steps", () => {
    const result = computeExecutionGroups([
      step({ step_id: "a", depends_on: ["b"] }),
      step({ step_id: "b", depends_on: ["a"] }),
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("cycle");
  });

  it("rejects a step that depends_on an unknown step_id", () => {
    const result = computeExecutionGroups([step({ step_id: "a", depends_on: ["missing"] })]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("unknown step_id");
  });

  it("rejects a step that depends on itself", () => {
    const result = computeExecutionGroups([step({ step_id: "a", depends_on: ["a"] })]);

    expect(result.ok).toBe(false);
  });

  it("returns an empty group list for an empty plan", () => {
    const result = computeExecutionGroups([]);
    expect(result).toEqual({ ok: true, value: [] });
  });
});

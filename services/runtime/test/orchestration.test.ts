import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Executor, PermissionManager, Planner, Verifier } from "../src/orchestration.js";
import type { ExecutionStep, ToolRegistration } from "../src/orchestration.js";
import { ResourceManager } from "../src/resource-manager.js";
import { MemoryLogSink, StructuredLogger } from "@nova/shared";
import { createWorkspaceCodeTool } from "../src/workspace-code-executor.js";
import { ToolRegistry } from "../src/tool-registry.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

const step = (overrides: Partial<ExecutionStep> = {}): ExecutionStep => ({
  step_id: "step-1",
  task_id: "task-1",
  correlation_id: "00000000-0000-4000-8000-000000000001",
  capability_id: "capability.filesystem",
  resolved_tool_id: "tool.filesystem",
  action_id: "read_file",
  parameters: { path: "/workspace/report.txt" },
  risk_tier: "read_only",
  execution_tier: "native_runtime",
  required_locks: [],
  timeout_ms: 15_000,
  confirmation_status: "not_required",
  ...overrides,
});

const readTool: ToolRegistration = {
  tool_id: "tool.filesystem",
  deterministic: true,
  actions: {
    read_file: {
      risk_tier: "read_only",
      verification_signal: "file_hash",
      idempotent: true,
      execute: async () => ({
        status: "success",
        evidence: { type: "file_hash", value: "hash-123" },
        affected_resources: ["/workspace/report.txt"],
      }),
    },
    delete_file: {
      risk_tier: "destructive_irreversible",
      verification_signal: "file_hash",
      idempotent: false,
      execute: async () => ({
        status: "success",
        evidence: { type: "file_hash", value: "deleted" },
        affected_resources: ["/workspace/report.txt"],
      }),
    },
  },
};

describe("Planner", () => {
  it("takes the deterministic path before invoking an LLM planner", async () => {
    const llmPlanner = vi.fn(async () => [step({ action_id: "llm_action" })]);
    const planner = new Planner({
      deterministic: new Map([["Git status", step({ action_id: "git_status" })]]),
      llmPlanner,
    });

    const result = await planner.plan({ task_id: "task-1", goal: "Git status" });

    expect(result).toMatchObject({
      ok: true,
      value: [{ action_id: "git_status", confirmation_status: "not_required" }],
    });
    expect(llmPlanner).not.toHaveBeenCalled();
  });

  it("does not emit an already-approved step", async () => {
    const planner = new Planner({ deterministic: new Map() });
    const result = await planner.plan({ task_id: "task-1", goal: "unknown" });

    expect(result).toMatchObject({ ok: false, error: { code: "NOVA-AI001" } });
  });
});

describe("PermissionManager and Executor", () => {
  it("blocks a tool outside the agent allowlist before invocation", async () => {
    const tool = vi.fn(readTool.actions.read_file.execute);
    const executor = new Executor(
      new PermissionManager({
        allowedToolIds: new Set(["tool.other"]),
        confirmationTimeoutMs: 300_000,
      }),
      new Map([
        [
          readTool.tool_id,
          { ...readTool, actions: { read_file: { ...readTool.actions.read_file, execute: tool } } },
        ],
      ]),
    );

    const result = await executor.execute(step());

    expect(result).toMatchObject({ ok: false, error: { code: "NOVA-SEC001" } });
    expect(tool).not.toHaveBeenCalled();
  });

  it("runs an allowed tool and returns structured evidence without reading memory", async () => {
    const executor = new Executor(
      new PermissionManager({
        allowedToolIds: new Set(["tool.filesystem"]),
        confirmationTimeoutMs: 300_000,
      }),
      new Map([[readTool.tool_id, readTool]]),
    );

    const result = await executor.execute(step());

    expect(result).toMatchObject({
      ok: true,
      value: {
        step_id: "step-1",
        status: "success",
        evidence: { type: "file_hash", value: "hash-123" },
      },
    });
  });

  it("requires confirmation for destructive actions and denies on timeout", async () => {
    const executor = new Executor(
      new PermissionManager({
        allowedToolIds: new Set(["tool.filesystem"]),
        confirmationTimeoutMs: 0,
      }),
      new Map([[readTool.tool_id, readTool]]),
    );

    const result = await executor.execute(
      step({
        risk_tier: "destructive_irreversible",
        confirmation_status: "pending",
        action_id: "delete_file",
      }),
    );

    expect(result).toMatchObject({ ok: false, error: { code: "NOVA-SEC001" } });
  });
});

describe("Workspace code execution through Executor", () => {
  it("requires explicit confirmation and releases the workspace lock after approved execution", async () => {
    const root = await mkdtemp(join(tmpdir(), "nova-orchestration-code-"));
    temporaryDirectories.push(root);
    const script = join(root, "ok.mjs");
    await writeFile(script, "process.stdout.write('verified');\n", "utf8");
    const codeTool = createWorkspaceCodeTool({
      workspaceRoot: root,
      runtimes: { node: process.execPath },
    });
    const resources = new ResourceManager();
    const executor = new Executor(
      new PermissionManager({
        allowedToolIds: new Set([codeTool.registration.tool_id]),
        confirmationTimeoutMs: 300_000,
      }),
      new Map([[codeTool.registration.tool_id, codeTool.registration]]),
      resources,
    );
    const planned = step({
      resolved_tool_id: codeTool.registration.tool_id,
      action_id: "run_script",
      capability_id: "workspace.code",
      execution_tier: "cli",
      risk_tier: "destructive_irreversible",
      required_locks: [`workspace:${root}`],
      parameters: { runtime_id: "node", script_path: script, args: [], timeout_ms: 2_000 },
      confirmation_status: "pending",
    });

    const blocked = await executor.execute(planned);
    expect(blocked).toMatchObject({ ok: false, error: { code: "NOVA-SEC001" } });
    expect(resources.holder(`workspace:${root}`)).toBeUndefined();

    const completed = await executor.execute({ ...planned, confirmation_status: "approved" });
    expect(completed).toMatchObject({
      ok: true,
      value: {
        status: "success",
        evidence: { type: "exit_code", value: { exit_code: 0, stdout: "verified" } },
      },
    });
    expect(resources.holder(`workspace:${root}`)).toBeUndefined();
  });
});

describe("Structured orchestration evidence", () => {
  it("logs correlated permission, invocation, result, and verification checkpoints without parameters", async () => {
    const sink = new MemoryLogSink();
    const logger = new StructuredLogger({ service: "runtime.orchestration", sink });
    const executor = new Executor(
      new PermissionManager(
        {
          allowedToolIds: new Set(["tool.filesystem"]),
          confirmationTimeoutMs: 300_000,
        },
        logger,
      ),
      new Map([[readTool.tool_id, readTool]]),
      undefined,
      logger,
    );

    const execution = await executor.execute(step());
    const verdict = new Verifier(logger).verify(
      step(),
      execution.ok
        ? execution.value
        : {
            step_id: "step-1",
            status: "failure",
            evidence: { type: "none", value: null },
            affected_resources: [],
          },
    );

    expect(execution).toMatchObject({ ok: true });
    expect(verdict).toMatchObject({ ok: true, value: { outcome: "verified" } });
    expect(sink.records().map((record) => record.event)).toEqual([
      "permission.decision",
      "executor.invocation",
      "executor.result",
      "verifier.outcome",
    ]);
    expect(sink.records().every((record) => record.correlation_id === step().correlation_id)).toBe(
      true,
    );
    expect(JSON.stringify(sink.records())).not.toContain("/workspace/report.txt");
  });
});

describe("Verifier", () => {
  it("returns verified only when evidence confirms the result", () => {
    const verifier = new Verifier();

    const result = verifier.verify(step({ parameters: { path: "/workspace/report.txt", expected_file_hash: "hash-123" } }), {
      step_id: "step-1",
      status: "success",
      evidence: { type: "file_hash", value: "hash-123" },
      affected_resources: ["/workspace/report.txt"],
    });

    expect(result).toEqual({
      ok: true,
      value: {
        step_id: "step-1",
        outcome: "verified",
        confidence: 1,
        verification_method: "ground_truth",
        explanation: "File hash matches the expected hash.",
      },
    });
  });

  it("verifies a hash weakly when no expected hash was declared to compare it against", () => {
    const verifier = new Verifier();

    const result = verifier.verify(step(), {
      step_id: "step-1",
      status: "success",
      evidence: { type: "file_hash", value: "hash-123" },
      affected_resources: ["/workspace/report.txt"],
    });

    expect(result).toMatchObject({ ok: true, value: { outcome: "verified", confidence: 0.6 } });
  });

  it("fails, not verifies, when a file hash contradicts the expected hash", () => {
    const verifier = new Verifier();

    const result = verifier.verify(step({ parameters: { expected_file_hash: "hash-123" } }), {
      step_id: "step-1",
      status: "success",
      evidence: { type: "file_hash", value: "hash-999" },
      affected_resources: ["/workspace/report.txt"],
    });

    expect(result).toMatchObject({ ok: true, value: { outcome: "failed", confidence: 1 } });
  });

  it("fails a claimed success when the actual exit code is non-zero", () => {
    const verifier = new Verifier();

    const result = verifier.verify(step(), {
      step_id: "step-1",
      status: "success",
      evidence: { type: "exit_code", value: 1 },
      affected_resources: [],
    });

    expect(result).toMatchObject({ ok: true, value: { outcome: "failed", confidence: 1 } });
  });

  it("fails a claimed success when the API response status is an error", () => {
    const verifier = new Verifier();

    const result = verifier.verify(step(), {
      step_id: "step-1",
      status: "success",
      evidence: { type: "api_response", value: { status: 500 } },
      affected_resources: [],
    });

    expect(result).toMatchObject({ ok: true, value: { outcome: "failed", confidence: 1 } });
  });

  it("flags evidence of a different type than the tool declared as unverified", () => {
    const registry = new ToolRegistry();
    registry.register({
      tool_id: "tool.filesystem",
      execution_tier: "native_runtime",
      deterministic: true,
      dependencies: [],
      target_entity_types: [],
      supported_actions: [
        {
          action_id: "read_file",
          risk_tier: "read_only",
          verification_signal: "file_hash",
          lockable_resources: [],
          permission_scope: "filesystem.read",
          estimated_latency_ms: 100,
          estimated_cost_class: "free",
          timeout_ms: 15_000,
          idempotent: true,
          input_schema: {},
          output_schema: {},
        },
      ],
    });
    const verifier = new Verifier(undefined, { toolRegistry: registry });

    const result = verifier.verify(step(), {
      step_id: "step-1",
      status: "success",
      evidence: { type: "exit_code", value: 0 },
      affected_resources: [],
    });

    expect(result).toMatchObject({ ok: true, value: { outcome: "unverified", confidence: 0.2 } });
  });

  it("keeps missing evidence as unverified instead of completed", () => {
    const verifier = new Verifier();

    const result = verifier.verify(step(), {
      step_id: "step-1",
      status: "success",
      evidence: { type: "none", value: null },
      affected_resources: [],
    });

    expect(result).toMatchObject({ ok: true, value: { outcome: "unverified", confidence: 0 } });
  });

  it("returns failed when structured execution reports failure", () => {
    const verifier = new Verifier();

    const result = verifier.verify(step(), {
      step_id: "step-1",
      status: "failure",
      evidence: { type: "exit_code", value: 1 },
      affected_resources: [],
      error: { category: "permanent", message: "file not found" },
    });

    expect(result).toMatchObject({
      ok: true,
      value: { outcome: "failed", verification_method: "ground_truth" },
    });
  });
});

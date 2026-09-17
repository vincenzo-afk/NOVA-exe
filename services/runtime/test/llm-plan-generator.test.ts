/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, expect, it } from "vitest";

import { createLlmPlanGenerator } from "../src/llm-plan-generator.js";
import { ModelRouter } from "../src/model-router.js";
import { ToolRegistry } from "../src/tool-registry.js";
import type { LlmProvider, ModelRequest, ModelResponse } from "../src/model-router.js";

function fakeProvider(respond: (request: ModelRequest) => string): LlmProvider {
  return {
    descriptor: {
      provider_id: "fake",
      domain: "llm",
      privacy_class: "cloud",
      schema_version: "1.0.0",
      cost_per_1k_tokens: 0,
      capabilities: {
        tool_calls: false,
        vision_input: false,
        streaming: false,
        max_context_tokens: 8_000,
      },
    },
    async healthCheck() {
      return "reachable";
    },
    async invoke(request: ModelRequest): Promise<ModelResponse> {
      return { text: respond(request), provider_id: "fake" };
    },
  };
}

function buildToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register({
    tool_id: "tool.filesystem",
    execution_tier: "native_runtime",
    deterministic: true,
    dependencies: [],
    target_entity_types: [],
    supported_actions: [
      {
        action_id: "write_file",
        risk_tier: "reversible_write",
        verification_signal: "file_hash",
        lockable_resources: ["file:/output.txt"],
        permission_scope: "filesystem.write",
        estimated_latency_ms: 50,
        estimated_cost_class: "free",
        timeout_ms: 5_000,
        idempotent: false,
        input_schema: {},
        output_schema: {},
      },
      {
        action_id: "read_file",
        risk_tier: "read_only",
        verification_signal: "file_hash",
        lockable_resources: [],
        permission_scope: "filesystem.read",
        estimated_latency_ms: 20,
        estimated_cost_class: "free",
        timeout_ms: 5_000,
        idempotent: true,
        input_schema: {},
        output_schema: {},
      },
    ],
  });
  return registry;
}

describe("createLlmPlanGenerator", () => {
  it("returns no steps and logs, rather than throwing, when no tools are registered", async () => {
    const router = new ModelRouter([fakeProvider(() => "[]")]);
    const generator = createLlmPlanGenerator({ router, tools: new ToolRegistry() });

    const steps = await generator("do something");

    expect(steps).toEqual([]);
  });

  it("grounds a valid model-proposed step against the real tool registry, ignoring the model's own risk_tier claim", async () => {
    const router = new ModelRouter([
      fakeProvider(() =>
        JSON.stringify([
          {
            capability_id: "capability.filesystem",
            resolved_tool_id: "tool.filesystem",
            action_id: "read_file",
            parameters: { path: "/report.txt" },
            risk_tier: "destructive_irreversible", // a hostile/mistaken claim the generator must ignore
          },
        ]),
      ),
    ]);
    const generator = createLlmPlanGenerator({ router, tools: buildToolRegistry() });

    const steps = await generator("read the report");

    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      resolved_tool_id: "tool.filesystem",
      action_id: "read_file",
      risk_tier: "read_only", // from the registry, not the model's claim
      timeout_ms: 5_000,
    });
  });

  it("drops a candidate referencing a tool or action that isn't in the registry, rather than fabricating a step", async () => {
    const router = new ModelRouter([
      fakeProvider(() =>
        JSON.stringify([
          { resolved_tool_id: "tool.made-up", action_id: "do_anything", parameters: {} },
        ]),
      ),
    ]);
    const generator = createLlmPlanGenerator({ router, tools: buildToolRegistry() });

    const steps = await generator("do something impossible");

    expect(steps).toEqual([]);
  });

  it("resolves depends_on_indices to real step_ids, only for steps that were actually grounded", async () => {
    const router = new ModelRouter([
      fakeProvider(() =>
        JSON.stringify([
          {
            resolved_tool_id: "tool.filesystem",
            action_id: "read_file",
            parameters: { path: "/a.txt" },
          },
          {
            resolved_tool_id: "tool.filesystem",
            action_id: "write_file",
            parameters: { path: "/output.txt" },
            depends_on_indices: [0],
          },
        ]),
      ),
    ]);
    const generator = createLlmPlanGenerator({ router, tools: buildToolRegistry() });

    const steps = await generator("read then write");

    expect(steps).toHaveLength(2);
    expect(steps[0]!.depends_on ?? []).toEqual([]);
    expect(steps[1]!.depends_on).toEqual([steps[0]!.step_id]);
  });

  it("drops a depends_on_indices entry that points at a rejected or out-of-range candidate instead of producing a broken reference", async () => {
    const router = new ModelRouter([
      fakeProvider(() =>
        JSON.stringify([
          { resolved_tool_id: "tool.made-up", action_id: "nope", parameters: {} }, // rejected — index 0
          {
            resolved_tool_id: "tool.filesystem",
            action_id: "read_file",
            parameters: { path: "/a.txt" },
            depends_on_indices: [0, 99],
          },
        ]),
      ),
    ]);
    const generator = createLlmPlanGenerator({ router, tools: buildToolRegistry() });

    const steps = await generator("one rejected, one valid");

    expect(steps).toHaveLength(1);
    expect(steps[0]!.depends_on ?? []).toEqual([]);
  });

  it("returns no steps, without throwing, when the model response is not parsable JSON", async () => {
    const router = new ModelRouter([fakeProvider(() => "not json at all")]);
    const generator = createLlmPlanGenerator({ router, tools: buildToolRegistry() });

    const steps = await generator("confuse the parser");

    expect(steps).toEqual([]);
  });
});

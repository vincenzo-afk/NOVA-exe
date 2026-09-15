import { randomUUID } from "node:crypto";

import type { StructuredLogger } from "@nova/shared";

import type { ExecutionStep } from "./orchestration.js";
import type { ModelRouter } from "./model-router.js";
import type { RegisteredTool, ToolRegistry } from "./tool-registry.js";

/**
 * The concrete `llmPlanner` `Planner`'s interface was always designed
 * to accept (`orchestration.ts`'s `PlannerDependencies.llmPlanner`) but
 * that no production code ever supplied — every desktop task submitted
 * failed at planning with "no deterministic resolution exists and no
 * model planner is available" because of this exact missing piece.
 *
 * The one rule this generator enforces harder than a naive
 * "ask the model for JSON" implementation would: **every field that
 * determines risk classification (risk_tier, execution_tier,
 * timeout_ms, required_locks) is taken from the authoritative
 * `ToolRegistry` entry, never from the model's own output.** The model
 * only ever chooses *which* registered tool_id/action_id pair to use
 * and *what parameters* to pass it — it cannot assert its own risk
 * tier for a step, which would otherwise let a model talk its way past
 * the confirmation tier a destructive action is supposed to carry.
 */

export interface LlmPlanGeneratorOptions {
  readonly router: ModelRouter;
  readonly tools: ToolRegistry;
  readonly logger?: StructuredLogger;
  readonly now?: () => number;
  readonly maxToolsInPrompt?: number;
}

interface RawStepCandidate {
  readonly resolved_tool_id?: unknown;
  readonly action_id?: unknown;
  readonly capability_id?: unknown;
  readonly parameters?: unknown;
}

export function createLlmPlanGenerator(
  options: LlmPlanGeneratorOptions,
): (goal: string) => Promise<readonly ExecutionStep[]> {
  return async (goal: string): Promise<readonly ExecutionStep[]> => {
    const catalog = buildToolCatalog(options.tools, options.maxToolsInPrompt ?? 40);
    if (catalog.length === 0) {
      options.logger?.warning("planner.llm.no_tools_registered", { goal });
      return [];
    }

    const response = await options.router.invoke({
      task_type: "planning",
      messages: [
        { role: "system", content: buildSystemPrompt(catalog) },
        { role: "user", content: goal },
      ],
      temperature: 0,
    });
    if (!response.ok) {
      options.logger?.warning("planner.llm.invoke_failed", {
        goal,
        error_code: response.error.code,
        error_message: response.error.message,
      });
      return [];
    }

    const raw = parseJsonArray(response.value.text);
    if (raw === undefined) {
      options.logger?.warning("planner.llm.unparsable_response", { goal });
      return [];
    }

    const steps: ExecutionStep[] = [];
    raw.forEach((candidate, index) => {
      const step = groundCandidate(candidate, options.tools, goal, index, options.now ?? Date.now);
      if (step) steps.push(step);
      else options.logger?.warning("planner.llm.candidate_rejected", { goal, index });
    });
    return steps;
  };
}

interface CatalogEntry {
  readonly tool: RegisteredTool;
  readonly action: RegisteredTool["supported_actions"][number];
}

function buildToolCatalog(registry: ToolRegistry, limit: number): readonly CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  for (const summary of registry.listSummaries().slice(0, limit)) {
    const full = registry.get(summary.tool_id);
    if (!full.ok) continue;
    for (const action of full.value.supported_actions) {
      entries.push({ tool: full.value, action });
    }
  }
  return entries;
}

function buildSystemPrompt(catalog: readonly CatalogEntry[]): string {
  const catalogJson = JSON.stringify(
    catalog.map((entry) => ({
      resolved_tool_id: entry.tool.tool_id,
      action_id: entry.action.action_id,
      risk_tier: entry.action.risk_tier,
      idempotent: entry.action.idempotent,
      input_schema: entry.action.input_schema,
    })),
  );
  return [
    "You are NOVA's task planner. Given a user goal, produce a plan as a JSON array of steps.",
    "You may ONLY use resolved_tool_id/action_id pairs from this exact catalog — never invent a tool or action that isn't listed:",
    catalogJson,
    "Respond with ONLY a JSON array (no prose, no markdown fences). Each element must have exactly these fields:",
    '{"capability_id": string, "resolved_tool_id": string (must match the catalog), "action_id": string (must match the catalog), "parameters": object (matching that action\'s input_schema)}',
    "If no catalog entry can accomplish the goal, respond with an empty array: []",
  ].join("\n\n");
}

function parseJsonArray(text: string): readonly unknown[] | undefined {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  try {
    const parsed: unknown = JSON.parse(stripped);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function groundCandidate(
  candidate: unknown,
  tools: ToolRegistry,
  goal: string,
  index: number,
  now: () => number,
): ExecutionStep | undefined {
  if (typeof candidate !== "object" || candidate === null) return undefined;
  const raw = candidate as RawStepCandidate;
  if (typeof raw.resolved_tool_id !== "string" || typeof raw.action_id !== "string") return undefined;

  const tool = tools.get(raw.resolved_tool_id);
  if (!tool.ok) return undefined;
  const action = tool.value.supported_actions.find((candidateAction) => candidateAction.action_id === raw.action_id);
  if (!action) return undefined;

  const parameters =
    typeof raw.parameters === "object" && raw.parameters !== null
      ? (raw.parameters as Readonly<Record<string, unknown>>)
      : {};
  const capabilityId =
    typeof raw.capability_id === "string" && raw.capability_id.length > 0 ? raw.capability_id : tool.value.tool_id;

  return {
    step_id: `llm-step-${now()}-${index}`,
    task_id: "", // Overwritten by Planner.plan() for every candidate — see orchestration.ts.
    correlation_id: randomUUID(),
    capability_id: capabilityId,
    resolved_tool_id: tool.value.tool_id,
    action_id: action.action_id,
    parameters,
    // Every field below is read from the authoritative ToolRegistry entry,
    // never from the model's own claim — this is the line that keeps a
    // model from talking itself past a confirmation tier it doesn't get to set.
    risk_tier: action.risk_tier,
    execution_tier: tool.value.execution_tier,
    required_locks: action.lockable_resources,
    timeout_ms: action.timeout_ms,
    confirmation_status: "not_required",
  };
}

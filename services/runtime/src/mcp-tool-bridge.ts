import type { Result } from "@nova/shared";
import { err, ok } from "@nova/shared";

import type { ExecutionResult, ToolAction, ToolRegistration } from "./orchestration.js";
import type { McpConnectionManager } from "./mcp-connection-manager.js";
import { McpToolCallRequestBuilder } from "./mcp-tool-call-request.js";
import { McpToolCallResultValidator } from "./mcp-tool-call-result.js";

/**
 * The piece that makes the rest of this genuinely useful rather than
 * a transport that has nothing plugged into it: an MCP server's tool
 * becomes a real `ToolAction`, executable through the exact same
 * `Executor` → `Verifier` → `RuntimeTaskCoordinator` pipeline every
 * other tool in this project already goes through — an MCP-provided
 * tool is not a second class of capability with its own execution
 * path, it is a `ToolRegistration` like any other, once wrapped here.
 */

export interface McpToolDescriptor {
  readonly server_id: string;
  readonly tool_name: string;
  readonly risk_tier: ToolAction["risk_tier"];
  readonly idempotent: boolean;
}

/** Wraps one MCP tool as a `ToolAction`. `verification_signal` is always `"api_response"` — an MCP tools/call result IS an API response, by construction, regardless of what the tool itself semantically does. */
export function createMcpToolAction(
  descriptor: McpToolDescriptor,
  connections: McpConnectionManager,
): ToolAction {
  const requestBuilder = new McpToolCallRequestBuilder();
  const resultValidator = new McpToolCallResultValidator();

  return {
    risk_tier: descriptor.risk_tier,
    verification_signal: "api_response",
    idempotent: descriptor.idempotent,
    execute: async (parameters): Promise<Omit<ExecutionResult, "step_id">> => {
      const connection = connections.get(descriptor.server_id);
      if (!connection.ok) {
        return {
          status: "failure",
          evidence: { type: "none", value: null },
          affected_resources: [],
        };
      }

      const request = requestBuilder.create(descriptor.tool_name, parameters);
      if (!request.ok) {
        return {
          status: "failure",
          evidence: { type: "none", value: null },
          affected_resources: [],
        };
      }

      const rawResponse = await connection.value.request({ ...request.value });
      if (!rawResponse.ok) {
        return {
          status: "failure",
          evidence: { type: "api_response", value: { status: 0, error: rawResponse.error.message } },
          affected_resources: [],
        };
      }

      const parsed = resultValidator.parse(
        rawResponse.value,
        request.value.id,
        descriptor.server_id,
        descriptor.tool_name,
      );
      if (!parsed.ok) {
        return {
          status: "failure",
          evidence: { type: "api_response", value: { status: 502, error: parsed.error.message } },
          affected_resources: [],
        };
      }

      const { tool_id: _toolId, action_id: _actionId, ...result } = parsed.value;
      return result;
    },
  };
}

/** Builds a full `ToolRegistration` covering every tool this MCP server currently exposes — one registration per server, one action per tool, so `Executor.execute()` can address any of them by `resolved_tool_id`/`action_id` exactly like a native NOVA tool. */
export function createMcpToolRegistration(
  serverId: string,
  tools: readonly McpToolDescriptor[],
  connections: McpConnectionManager,
): Result<ToolRegistration> {
  if (tools.some((tool) => tool.server_id !== serverId)) {
    return err({
      code: "NOVA-TL002",
      message: "Every tool descriptor passed to createMcpToolRegistration must belong to the same server_id.",
      retryable: false,
    });
  }
  const actions: Record<string, ToolAction> = {};
  for (const tool of tools) {
    actions[tool.tool_name] = createMcpToolAction(tool, connections);
  }
  return ok({ tool_id: serverId, deterministic: false, actions });
}

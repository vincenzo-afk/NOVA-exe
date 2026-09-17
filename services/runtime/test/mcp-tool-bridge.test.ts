/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, expect, it } from "vitest";

import { McpConnectionManager } from "../src/mcp-connection-manager.js";
import { createMcpToolRegistration } from "../src/mcp-tool-bridge.js";
import { Executor, PermissionManager, Verifier } from "../src/orchestration.js";

describe("MCP transport end-to-end: a connected server's tool becomes a real, executable ToolAction", () => {
  it("routes a tools/call through McpConnection and the real Executor + Verifier, verified on a 200 response", async () => {
    // A minimal fake HTTP MCP server: echoes back a successful tools/call result for any request id.
    const fetcher = (async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string) as { readonly id: number };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          jsonrpc: "2.0",
          id: body.id,
          result: { content: [{ type: "text", text: "42 degrees" }], isError: false },
        }),
      };
    }) as unknown as typeof fetch;

    const connections = new McpConnectionManager({ fetcher });
    const connected = await connections.connect({
      server_id: "weather-server",
      label: "Weather",
      state: "Connected",
      transport: "streamable-http",
      endpoint: "https://example.com/mcp",
    });
    expect(connected.ok).toBe(true);

    const registration = createMcpToolRegistration(
      "weather-server",
      [
        {
          server_id: "weather-server",
          tool_name: "get_weather",
          risk_tier: "read_only",
          idempotent: true,
        },
      ],
      connections,
    );
    expect(registration.ok).toBe(true);
    if (!registration.ok) return;

    const executor = new Executor(
      new PermissionManager({
        allowedToolIds: new Set(["weather-server"]),
        confirmationTimeoutMs: 0,
      }),
      new Map([["weather-server", registration.value]]),
    );
    const verifier = new Verifier();

    const step = {
      step_id: "step-1",
      task_id: "task-1",
      correlation_id: "00000000-0000-4000-8000-000000000001",
      capability_id: "capability.weather",
      resolved_tool_id: "weather-server",
      action_id: "get_weather",
      parameters: { location: "here" },
      risk_tier: "read_only" as const,
      execution_tier: "mcp" as const,
      required_locks: [],
      timeout_ms: 5_000,
      confirmation_status: "not_required" as const,
    };

    const executed = await executor.execute(step);
    expect(executed.ok).toBe(true);
    if (!executed.ok) return;
    expect(executed.value.status).toBe("success");
    expect(executed.value.evidence.type).toBe("api_response");

    const verdict = verifier.verify(step, executed.value);
    expect(verdict).toMatchObject({ ok: true, value: { outcome: "verified" } });

    await connections.disconnectAll();
  });

  it("propagates an HTTP error from the MCP server as a failed, not verified, step result", async () => {
    const fetcher = (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch;
    const connections = new McpConnectionManager({ fetcher });
    await connections.connect({
      server_id: "flaky-server",
      label: "Flaky",
      state: "Connected",
      transport: "streamable-http",
      endpoint: "https://example.com/mcp",
    });
    const registration = createMcpToolRegistration(
      "flaky-server",
      [
        {
          server_id: "flaky-server",
          tool_name: "do_thing",
          risk_tier: "read_only",
          idempotent: true,
        },
      ],
      connections,
    );
    if (!registration.ok) throw new Error("registration failed");

    const executor = new Executor(
      new PermissionManager({
        allowedToolIds: new Set(["flaky-server"]),
        confirmationTimeoutMs: 0,
      }),
      new Map([["flaky-server", registration.value]]),
    );
    const step = {
      step_id: "step-1",
      task_id: "task-1",
      correlation_id: "00000000-0000-4000-8000-000000000001",
      capability_id: "capability.flaky",
      resolved_tool_id: "flaky-server",
      action_id: "do_thing",
      parameters: {},
      risk_tier: "read_only" as const,
      execution_tier: "mcp" as const,
      required_locks: [],
      timeout_ms: 5_000,
      confirmation_status: "not_required" as const,
    };

    const executed = await executor.execute(step);
    expect(executed).toMatchObject({ ok: true, value: { status: "failure" } });
  });

  it("returns an error rather than executing when the server was never connected", async () => {
    const connections = new McpConnectionManager();
    const registration = createMcpToolRegistration(
      "never-connected",
      [
        {
          server_id: "never-connected",
          tool_name: "do_thing",
          risk_tier: "read_only",
          idempotent: true,
        },
      ],
      connections,
    );
    if (!registration.ok) throw new Error("registration failed");

    const result = await registration.value.actions["do_thing"]!.execute({});

    expect(result.status).toBe("failure");
  });
});

describe("McpConnectionManager", () => {
  it("does not open a second connection when one is already open for the same server", async () => {
    const fetcher = (async () => {
      return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result: {} }) };
    }) as unknown as typeof fetch;
    const connections = new McpConnectionManager({ fetcher });
    const server = {
      server_id: "s1",
      label: "S1",
      state: "Connected" as const,
      transport: "streamable-http" as const,
      endpoint: "https://example.com/mcp",
    };

    await connections.connect(server);
    await connections.connect(server);

    expect(connections.isConnected("s1")).toBe(true);
    const first = connections.get("s1");
    await connections.connect(server);
    const second = connections.get("s1");
    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true });
    if (first.ok && second.ok) expect(first.value).toBe(second.value); // same instance, not reconnected
  });

  it("reports no connection for an unknown or never-connected server", () => {
    const connections = new McpConnectionManager();
    expect(connections.isConnected("nope")).toBe(false);
    expect(connections.get("nope")).toMatchObject({ ok: false, error: { code: "NOVA-NET001" } });
  });
});

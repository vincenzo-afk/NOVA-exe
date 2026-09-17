import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import { McpConnection, type McpSpawnFn, type SpawnedMcpProcess } from "../src/mcp-connection.js";

/** A minimal, honest fake of the handful of child-process members McpConnection actually uses — not the entire Node child-process API. */
function fakeProcess(): SpawnedMcpProcess & { readonly emitter: EventEmitter; readonly stdoutEmitter: EventEmitter; readonly written: string[] } {
  const emitter = new EventEmitter();
  const stdoutEmitter = new EventEmitter();
  const written: string[] = [];
  return {
    emitter,
    stdoutEmitter,
    written,
    stdin: { write: (data: string) => (written.push(data), true) },
    stdout: {
      setEncoding: () => undefined,
      on: (_event, listener) => {
        stdoutEmitter.on("data", listener);
      },
    },
    killed: false,
    on: (event: "exit" | "error", listener: (arg: never) => void) => {
      emitter.on(event, listener);
    },
    kill: () => undefined,
  };
}

describe("McpConnection (stdio)", () => {
  it("sends a request over stdin and resolves with the matching response received on stdout", async () => {
    const proc = fakeProcess();
    const spawnFn: McpSpawnFn = vi.fn(() => proc);
    const connection = new McpConnection({
      plan: { transport: "stdio", command: "mcp-server", args: [] },
      spawnFn,
    });

    const requestPromise = connection.request({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    // Simulate the server writing its line-delimited JSON-RPC response.
    queueMicrotask(() => {
      proc.stdoutEmitter.emit("data", `${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [] } })}\n`);
    });

    const result = await requestPromise;

    expect(spawnFn).toHaveBeenCalledWith("mcp-server", [], { stdio: ["pipe", "pipe", "pipe"] });
    expect(proc.written[0]).toContain('"method":"tools/list"');
    expect(result).toEqual({ ok: true, value: { jsonrpc: "2.0", id: 1, result: { tools: [] } } });
  });

  it("correlates concurrent requests by id, even when responses arrive out of order", async () => {
    const proc = fakeProcess();
    const connection = new McpConnection({ plan: { transport: "stdio", command: "mcp-server", args: [] }, spawnFn: () => proc });

    const first = connection.request({ jsonrpc: "2.0", id: 1, method: "a", params: {} });
    const second = connection.request({ jsonrpc: "2.0", id: 2, method: "b", params: {} });
    queueMicrotask(() => {
      proc.stdoutEmitter.emit("data", `${JSON.stringify({ jsonrpc: "2.0", id: 2, result: "second" })}\n`);
      proc.stdoutEmitter.emit("data", `${JSON.stringify({ jsonrpc: "2.0", id: 1, result: "first" })}\n`);
    });

    expect(await first).toMatchObject({ ok: true, value: { result: "first" } });
    expect(await second).toMatchObject({ ok: true, value: { result: "second" } });
  });

  it("handles a response split across multiple stdout chunks", async () => {
    const proc = fakeProcess();
    const connection = new McpConnection({ plan: { transport: "stdio", command: "mcp-server", args: [] }, spawnFn: () => proc });

    const requestPromise = connection.request({ jsonrpc: "2.0", id: 1, method: "a", params: {} });
    const fullLine = `${JSON.stringify({ jsonrpc: "2.0", id: 1, result: "chunked" })}\n`;
    queueMicrotask(() => {
      proc.stdoutEmitter.emit("data", fullLine.slice(0, 10));
      proc.stdoutEmitter.emit("data", fullLine.slice(10));
    });

    expect(await requestPromise).toMatchObject({ ok: true, value: { result: "chunked" } });
  });

  it("fails every pending request when the process exits", async () => {
    const proc = fakeProcess();
    const connection = new McpConnection({ plan: { transport: "stdio", command: "mcp-server", args: [] }, spawnFn: () => proc });

    const requestPromise = connection.request({ jsonrpc: "2.0", id: 1, method: "a", params: {} });
    queueMicrotask(() => proc.emitter.emit("exit", 1));

    const result = await requestPromise;
    expect(result).toMatchObject({ ok: false, error: { code: "NOVA-NET001" } });
  });

  it("times out a request that never gets a response", async () => {
    const proc = fakeProcess();
    const connection = new McpConnection({
      plan: { transport: "stdio", command: "mcp-server", args: [] },
      spawnFn: () => proc,
      requestTimeoutMs: 10,
    });

    const result = await connection.request({ jsonrpc: "2.0", id: 1, method: "a", params: {} });

    expect(result).toMatchObject({ ok: false, error: { code: "NOVA-NET001", retryable: true } });
  });

  it("rejects new requests after close()", async () => {
    const proc = fakeProcess();
    const connection = new McpConnection({ plan: { transport: "stdio", command: "mcp-server", args: [] }, spawnFn: () => proc });
    await connection.connect();
    await connection.close();

    const result = await connection.request({ jsonrpc: "2.0", id: 1, method: "a", params: {} });

    expect(result).toMatchObject({ ok: false, error: { code: "NOVA-NET001" } });
  });
});

describe("McpConnection (streamable-http)", () => {
  it("POSTs the request and resolves with the parsed JSON response", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: "2.0", id: 1, result: { ok: true } }),
    })) as unknown as typeof fetch;
    const connection = new McpConnection({
      plan: { transport: "streamable-http", endpoint: "https://example.com/mcp" },
      fetcher,
    });

    const result = await connection.request({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });

    expect(fetcher).toHaveBeenCalledWith(
      "https://example.com/mcp",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result).toEqual({ ok: true, value: { jsonrpc: "2.0", id: 1, result: { ok: true } } });
  });

  it("returns a retryable error on a 5xx response and a non-retryable one on 4xx", async () => {
    const serverErrorFetcher = vi.fn(async () => ({ ok: false, status: 503 })) as unknown as typeof fetch;
    const serverErrorConnection = new McpConnection({
      plan: { transport: "streamable-http", endpoint: "https://example.com/mcp" },
      fetcher: serverErrorFetcher,
    });
    const clientErrorFetcher = vi.fn(async () => ({ ok: false, status: 401 })) as unknown as typeof fetch;
    const clientErrorConnection = new McpConnection({
      plan: { transport: "streamable-http", endpoint: "https://example.com/mcp" },
      fetcher: clientErrorFetcher,
    });

    const serverErrorResult = await serverErrorConnection.request({ jsonrpc: "2.0", id: 1, method: "a", params: {} });
    const clientErrorResult = await clientErrorConnection.request({ jsonrpc: "2.0", id: 1, method: "a", params: {} });

    expect(serverErrorResult).toMatchObject({ ok: false, error: { retryable: true } });
    expect(clientErrorResult).toMatchObject({ ok: false, error: { retryable: false } });
  });

  it("resolves and sends the credential when the plan declares an auth_reference", async () => {
    const mockFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: "2.0", id: 1, result: {} }),
    }));
    const resolveCredential = vi.fn(async (reference: string) => `secret-for-${reference}`);
    const connection = new McpConnection({
      plan: { transport: "streamable-http", endpoint: "https://example.com/mcp", auth_reference: "vault://mcp-key" },
      fetcher: mockFetch as unknown as typeof fetch,
      resolveCredential,
    });

    await connection.request({ jsonrpc: "2.0", id: 1, method: "a", params: {} });

    expect(resolveCredential).toHaveBeenCalledWith("vault://mcp-key");
    const [, init] = mockFetch.mock.calls[0]!;
    expect((init!.headers as Headers).get("authorization")).toBe("Bearer secret-for-vault://mcp-key");
  });

  it("fails clearly when an auth_reference is declared but no credential resolver was supplied", async () => {
    const connection = new McpConnection({
      plan: { transport: "streamable-http", endpoint: "https://example.com/mcp", auth_reference: "vault://mcp-key" },
    });

    const result = await connection.request({ jsonrpc: "2.0", id: 1, method: "a", params: {} });

    expect(result).toMatchObject({ ok: false, error: { code: "NOVA-SEC001" } });
  });
});

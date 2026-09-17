import { spawn } from "node:child_process";

import { err, ok, type ErrorInfo, type Result } from "@nova/shared";

import type { McpTransportPlan } from "./mcp-transport-planner.js";

/**
 * The transport layer none of the ~30 mcp-*.ts message-shape files
 * ever had (`docs/references/feature-gap-analysis.md`'s "phone with
 * no service"): this actually spawns the stdio child process or opens
 * the streamable-HTTP connection `McpTransportPlanner.plan()` only
 * ever *described*, writes real JSON-RPC request bytes to it, and
 * resolves the matching response by `id` when it arrives. Every
 * existing request-builder/response-validator pair
 * (`mcp-tool-call-request.ts` / `mcp-tool-call-result.ts`, and every
 * other `mcp-*-request.ts` / `mcp-*-response.ts` pair) can now
 * actually be used, by calling `request()` with whatever object the
 * builder produced and handing the raw result to the matching
 * validator — this class knows nothing about MCP method semantics, it
 * only knows how to move one JSON-RPC object out and get the matching
 * one back.
 *
 * stdio framing follows the MCP spec's line-delimited convention: one
 * complete JSON-RPC message per line on stdin/stdout. Streamable-HTTP
 * here covers the single-request/single-response case (a `POST` with
 * a JSON body, a JSON response) — the spec's optional SSE streaming
 * response mode is real follow-up work this class does not claim to
 * implement; every response this class returns is a single, complete
 * JSON-RPC object.
 */

/**
 * Only the handful of child-process members this class actually uses
 * — not the full `ChildProcessWithoutNullStreams` shape — so a test
 * double only has to implement what's genuinely exercised instead of
 * the entire Node child-process API surface. The real `node:child_process`
 * `spawn()` already satisfies this structurally; no adapter is needed
 * for the production path.
 */
export interface SpawnedMcpProcess {
  readonly stdin: { write(data: string): boolean };
  readonly stdout: { setEncoding(encoding: string): void; on(event: "data", listener: (chunk: string) => void): void };
  readonly killed: boolean;
  on(event: "exit", listener: (code: number | null) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  kill(): void;
}

export type McpSpawnFn = (
  command: string,
  args: readonly string[],
  options: { readonly stdio: readonly ["pipe", "pipe", "pipe"] },
) => SpawnedMcpProcess;

export interface McpConnectionOptions {
  readonly plan: McpTransportPlan;
  readonly resolveCredential?: (reference: string) => Promise<string>;
  readonly requestTimeoutMs?: number;
  readonly fetcher?: typeof fetch;
  readonly spawnFn?: McpSpawnFn;
}

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

export class McpConnection {
  private readonly options: McpConnectionOptions;
  private process: SpawnedMcpProcess | undefined;
  private stdoutBuffer = "";
  private readonly pending = new Map<string | number, PendingRequest>();
  private closed = false;

  public constructor(options: McpConnectionOptions) {
    this.options = options;
  }

  /**
   * For stdio, spawns the child process and wires up line-delimited
   * response parsing. For streamable-http, there is no persistent
   * connection to open — each `request()` call is its own POST — so
   * this is a no-op beyond validating the plan.
   */
  public async connect(): Promise<Result<void>> {
    if (this.options.plan.transport !== "stdio") return ok(undefined);
    if (this.process) return ok(undefined);

    try {
      const spawnFn = this.options.spawnFn ?? spawn;
      const child = spawnFn(this.options.plan.command, [...this.options.plan.args], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.process = child;
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => this.onStdoutData(chunk));
      child.on("exit", (code: number | null) => this.onProcessExit(code));
      child.on("error", (error: Error) => this.failAllPending(error));
      return ok(undefined);
    } catch (cause) {
      return err(this.transportError(cause, "Failed to spawn the MCP server process."));
    }
  }

  public async close(): Promise<void> {
    this.closed = true;
    this.failAllPending(new Error("MCP connection closed."));
    if (this.process && !this.process.killed) {
      this.process.kill();
    }
    this.process = undefined;
  }

  /**
   * Sends one JSON-RPC request object and resolves with the matching
   * JSON-RPC response object (correlated by `id`) — callers hand this
   * whatever an `Mcp*RequestBuilder.create()` produced and pass the
   * result straight to the matching `Mcp*ResponseValidator`/`*Result*`
   * parser; this method does not interpret the payload.
   */
  public async request(payload: Readonly<Record<string, unknown>>): Promise<Result<unknown>> {
    if (this.closed) {
      return err({ code: "NOVA-NET001", message: "MCP connection is closed.", retryable: false });
    }
    return this.options.plan.transport === "stdio"
      ? this.requestOverStdio(payload)
      : this.requestOverHttp(payload);
  }

  private async requestOverStdio(payload: Readonly<Record<string, unknown>>): Promise<Result<unknown>> {
    if (!this.process) {
      const connected = await this.connect();
      if (!connected.ok) return connected;
    }
    const child = this.process;
    if (!child) {
      return err({ code: "NOVA-NET001", message: "MCP stdio process is not running.", retryable: true });
    }

    const id = payload["id"];
    if (typeof id !== "string" && typeof id !== "number") {
      return err({ code: "NOVA-TL002", message: "MCP request payload is missing a correlatable 'id'.", retryable: false });
    }

    return new Promise<Result<unknown>>((resolve) => {
      const timeoutMs = this.options.requestTimeoutMs ?? 30_000;
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        resolve(err({ code: "NOVA-NET001", message: `MCP request '${id}' timed out after ${timeoutMs}ms.`, retryable: true }));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => resolve(ok(value)),
        reject: (error) => resolve(err({ code: "NOVA-NET001", message: error.message, retryable: true })),
        timeout,
      });

      try {
        child.stdin.write(`${JSON.stringify(payload)}\n`);
      } catch (cause) {
        this.pending.delete(id);
        clearTimeout(timeout);
        resolve(err(this.transportError(cause, "Failed to write to the MCP server's stdin.")));
      }
    });
  }

  private async requestOverHttp(payload: Readonly<Record<string, unknown>>): Promise<Result<unknown>> {
    if (this.options.plan.transport !== "streamable-http") {
      return err({ code: "NOVA-TL002", message: "Connection plan does not use streamable-http.", retryable: false });
    }
    const fetcher = this.options.fetcher ?? fetch;
    const headers = new Headers({ "content-type": "application/json", accept: "application/json" });
    if (this.options.plan.auth_reference) {
      if (!this.options.resolveCredential) {
        return err({
          code: "NOVA-SEC001",
          message: "MCP server requires an auth_reference but no credential resolver was supplied.",
          retryable: false,
        });
      }
      const credential = await this.options.resolveCredential(this.options.plan.auth_reference);
      headers.set("authorization", `Bearer ${credential}`);
    }

    const timeoutMs = this.options.requestTimeoutMs ?? 30_000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(this.options.plan.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) {
        return err({
          code: "NOVA-NET001",
          message: `MCP server responded with HTTP ${response.status}.`,
          retryable: response.status >= 500,
        });
      }
      const body = (await response.json()) as unknown;
      return ok(body);
    } catch (cause) {
      return err(this.transportError(cause, "MCP HTTP request failed."));
    } finally {
      clearTimeout(timeout);
    }
  }

  private onStdoutData(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newlineIndex = this.stdoutBuffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (line.length > 0) this.onMessageLine(line);
      newlineIndex = this.stdoutBuffer.indexOf("\n");
    }
  }

  private onMessageLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return; // A malformed line from the server's stdout is dropped, not fatal to the connection.
    }
    if (typeof parsed !== "object" || parsed === null) return;
    const id = (parsed as Record<string, unknown>)["id"];
    if (typeof id !== "string" && typeof id !== "number") return; // A notification (no id) — no pending request to resolve.
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(id);
    pending.resolve(parsed);
  }

  private onProcessExit(code: number | null): void {
    this.process = undefined;
    this.failAllPending(new Error(`MCP server process exited with code ${code ?? "unknown"}.`));
  }

  private failAllPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  private transportError(cause: unknown, message: string): ErrorInfo {
    return {
      code: "NOVA-NET001",
      message: `${message} ${cause instanceof Error ? cause.message : String(cause)}`,
      retryable: true,
    };
  }
}

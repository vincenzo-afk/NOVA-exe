import { err, ok, type Result } from "@nova/shared";

import type { McpServerConfiguration } from "./configuration-store.js";
import { McpConnection, type McpConnectionOptions } from "./mcp-connection.js";
import { McpTransportPlanner } from "./mcp-transport-planner.js";

/**
 * `McpServerManager`'s "Connected" state was a label — nothing backed
 * it with an actual connection. This ties the two together: entering
 * `Connected` opens a real `McpConnection` (spawning the stdio process
 * or validating the HTTP plan), and leaving it (`Disabled`/`Removed`)
 * closes that connection. `McpServerManager` itself is unchanged —
 * this is a layer that reacts to its transitions, not a replacement
 * for its approval/lifecycle logic.
 */

export interface McpConnectionManagerOptions {
  readonly resolveCredential?: (reference: string) => Promise<string>;
  readonly requestTimeoutMs?: number;
  readonly fetcher?: typeof fetch;
  readonly spawnFn?: McpConnectionOptions["spawnFn"];
}

export class McpConnectionManager {
  private readonly planner = new McpTransportPlanner();
  private readonly connections = new Map<string, McpConnection>();

  public constructor(private readonly options: McpConnectionManagerOptions = {}) {}

  /** Called once a server actually transitions to Connected (`McpServerManager.approve()` returning ok) — opens the real connection. */
  public async connect(server: McpServerConfiguration): Promise<Result<void>> {
    const existing = this.connections.get(server.server_id);
    if (existing) return ok(undefined);

    const plan = this.planner.plan(server);
    if (!plan.ok) return plan;

    const connection = new McpConnection({
      plan: plan.value,
      ...(this.options.resolveCredential ? { resolveCredential: this.options.resolveCredential } : {}),
      ...(this.options.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: this.options.requestTimeoutMs }),
      ...(this.options.fetcher ? { fetcher: this.options.fetcher } : {}),
      ...(this.options.spawnFn ? { spawnFn: this.options.spawnFn } : {}),
    });
    const connected = await connection.connect();
    if (!connected.ok) return connected;

    this.connections.set(server.server_id, connection);
    return ok(undefined);
  }

  /** Called when a server leaves Connected (disabled, removed, or replaced) — closes the real connection, if one is open. */
  public async disconnect(serverId: string): Promise<void> {
    const connection = this.connections.get(serverId);
    if (!connection) return;
    await connection.close();
    this.connections.delete(serverId);
  }

  public get(serverId: string): Result<McpConnection> {
    const connection = this.connections.get(serverId);
    return connection
      ? ok(connection)
      : err({ code: "NOVA-NET001", message: `No active MCP connection for server '${serverId}'.`, retryable: false });
  }

  public isConnected(serverId: string): boolean {
    return this.connections.has(serverId);
  }

  public async disconnectAll(): Promise<void> {
    await Promise.all([...this.connections.keys()].map((serverId) => this.disconnect(serverId)));
  }
}

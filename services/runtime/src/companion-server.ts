import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { CompanionCommandBridge } from "./companion-command-bridge.js";
import { type CompanionCommandResult } from "./companion-command-bridge.js";
import type {
  CompanionPairingCoordinator,
  CompanionSessionStore,
} from "./companion-pairing-session.js";
import type { CompanionTokenIssuer } from "./companion-pairing-session.js";
import { createCompanionSyncTransport, type CompanionSyncBroker } from "./companion-sync-store.js";
import type { PairingRequest } from "./device-pairing.js";
import type { VisionPipeline } from "./vision-pipeline.js";
import { CrossDeviceSyncManager, type SyncChange } from "./cross-device-sync.js";

/**
 * The real HTTP transport docs/references/feature-gap-analysis.md
 * flagged as missing: pairing, sync, remote app-control/file-access
 * commands, and vision frames all move over this one small server,
 * using the same raw `node:http` + bearer-token style already
 * established by `rest-api.ts` and `websocket-api.ts` rather than
 * introducing a new HTTP framework dependency for one more server.
 *
 * Deliberately HTTP request/response, not a persistent WebSocket, for
 * the companion device: the phone is not expected to hold an
 * always-open connection (docs/20-devices/android-companion.md's
 * "no hidden background listening mode" / foreground-service-gated
 * model) — it polls while its foreground service is active and stops
 * polling when it isn't. `companion-command-bridge.ts`'s queue is
 * exactly the accommodation for that: a command waits until the next
 * poll picks it up, rather than requiring instant delivery.
 */

export interface CompanionServerOptions {
  readonly pairing: CompanionPairingCoordinator;
  readonly sessions: CompanionSessionStore;
  readonly tokens: CompanionTokenIssuer;
  readonly syncBroker: CompanionSyncBroker;
  readonly commands: CompanionCommandBridge;
  readonly vision: VisionPipeline;
  readonly host?: string;
  readonly port?: number;
}

export class CompanionServer {
  private readonly host: string;
  private readonly port: number;
  private server: Server | undefined;
  private boundPort: number | undefined;
  private readonly syncManagersByDevice = new Map<string, CrossDeviceSyncManager>();

  public constructor(private readonly options: CompanionServerOptions) {
    this.host = options.host ?? "0.0.0.0"; // Unlike the desktop-local rest-api.ts/websocket-api.ts, this server must accept LAN connections from the paired phone, not just loopback.
    this.port = options.port ?? 0;
  }

  public async start(): Promise<void> {
    if (this.server) return;
    this.server = createServer((request, response) => void this.handle(request, response));
    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(this.port, this.host, () => {
        const address = this.server?.address();
        this.boundPort = typeof address === "object" && address ? address.port : this.port;
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
    this.server = undefined;
    this.boundPort = undefined;
  }

  public url(): string {
    if (this.boundPort === undefined) throw new Error("Companion server is not started.");
    return `http://${this.host}:${this.boundPort}`;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader("content-type", "application/json; charset=utf-8");
    const url = new URL(request.url ?? "/", `http://${this.host}`);

    try {
      if (request.method === "POST" && url.pathname === "/v1/companion/pair/offer") {
        const body = (await this.readJsonBody(request)) as {
          runtime_mode?: "Full peer" | "Companion";
        };
        const runtimeMode = body.runtime_mode === "Full peer" ? "Full peer" : "Companion";
        const offer = this.options.pairing.createOffer(runtimeMode);
        this.send(response, offer.ok ? 200 : 400, offer.ok ? offer.value : { error: offer.error });
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/companion/pair/sign-challenge") {
        const body = (await this.readJsonBody(request)) as {
          code?: string;
          channel_token?: string;
          challenge_b64?: string;
        };
        if (
          typeof body.code !== "string" ||
          typeof body.channel_token !== "string" ||
          typeof body.challenge_b64 !== "string"
        ) {
          this.send(response, 400, {
            error: {
              code: "NOVA-TL003",
              message: "code, channel_token, and challenge_b64 are required.",
            },
          });
          return;
        }
        const result = this.options.pairing.signChallenge(
          body.code,
          body.channel_token,
          body.challenge_b64,
        );
        this.send(
          response,
          result.ok ? 200 : 401,
          result.ok ? { signature_b64: result.value } : { error: result.error },
        );
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/companion/pair/complete") {
        const body = (await this.readJsonBody(request)) as {
          code?: string;
          request?: PairingRequest;
        };
        if (typeof body.code !== "string" || !body.request) {
          this.send(response, 400, {
            error: { code: "NOVA-TL003", message: "code and request are required." },
          });
          return;
        }
        const result = this.options.pairing.completePairing(body.code, body.request);
        if (!result.ok) {
          this.send(response, 400, { error: result.error });
          return;
        }
        this.send(response, 200, { device: result.value.device, token: result.value.token });
        return;
      }

      // Every route below requires an authenticated, paired device.
      const deviceId = this.authenticate(request);
      if (!deviceId) {
        this.send(response, 401, {
          error: { code: "NOVA-SEC001", message: "A valid companion bearer token is required." },
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/companion/sync/pull") {
        const body = (await this.readJsonBody(request)) as { since_logical_clock?: number };
        const manager = this.syncManagerFor(deviceId);
        void manager; // The manager instance is retained for the device's own local-record projection; the raw pull below is what the wire protocol actually needs.
        const result = this.options.syncBroker.pull(deviceId, body.since_logical_clock ?? 0);
        this.send(
          response,
          result.ok ? 200 : 400,
          result.ok ? result.value : { error: result.error },
        );
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/companion/sync/push") {
        const body = (await this.readJsonBody(request)) as { envelopes?: unknown };
        if (!Array.isArray(body.envelopes)) {
          this.send(response, 400, {
            error: { code: "NOVA-TL003", message: "envelopes must be an array." },
          });
          return;
        }
        const result = this.options.syncBroker.push(deviceId, body.envelopes);
        this.send(
          response,
          result.ok ? 200 : 400,
          result.ok ? result.value : { error: result.error },
        );
        return;
      }

      if (request.method === "GET" && url.pathname === "/v1/companion/commands/next") {
        const commands = this.options.commands.takeQueuedCommands(deviceId);
        this.send(response, 200, { commands });
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/companion/commands/result") {
        const body = (await this.readJsonBody(request)) as {
          command_id?: string;
          result?: CompanionCommandResult;
        };
        if (typeof body.command_id !== "string" || !body.result) {
          this.send(response, 400, {
            error: { code: "NOVA-TL003", message: "command_id and result are required." },
          });
          return;
        }
        const result = this.options.commands.submitResult(body.command_id, body.result);
        this.send(
          response,
          result.ok ? 200 : 404,
          result.ok ? { accepted: true } : { error: result.error },
        );
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/companion/vision/frame") {
        const body = (await this.readJsonBody(request)) as {
          frame_b64?: string;
          captured_at_epoch_ms?: number;
          hint?: string;
        };
        if (typeof body.frame_b64 !== "string") {
          this.send(response, 400, {
            error: { code: "NOVA-TL003", message: "frame_b64 is required." },
          });
          return;
        }
        const result = await this.options.vision.processFrame({
          device_id: deviceId,
          frame_b64: body.frame_b64,
          captured_at_epoch_ms: body.captured_at_epoch_ms ?? Date.now(),
          ...(typeof body.hint === "string" ? { hint: body.hint } : {}),
        });
        this.send(
          response,
          result.ok ? 200 : 400,
          result.ok ? { objects: result.value } : { error: result.error },
        );
        return;
      }

      this.send(response, 404, {
        error: { code: "NOVA-TL003", message: "Unknown companion route." },
      });
    } catch (error) {
      this.send(response, 400, {
        error: {
          code: "NOVA-TL003",
          message: error instanceof Error ? error.message : "Malformed request body.",
        },
      });
    }
  }

  /**
   * Lazily builds this device's `CrossDeviceSyncManager` against a
   * transport backed by the shared broker + that device's derived
   * session key, so the desktop's own local-record view of synced
   * state (`manager.record(entityId)`) stays available even though
   * the wire protocol above talks to the broker directly for the
   * pull/push bytes themselves.
   */
  private syncManagerFor(deviceId: string): CrossDeviceSyncManager {
    const existing = this.syncManagersByDevice.get(deviceId);
    if (existing) return existing;
    const session = this.options.sessions.get(deviceId);
    if (!session) throw new Error("No active session for this device.");
    const transport = createCompanionSyncTransport(
      this.options.syncBroker,
      deviceId,
      session.sessionKey,
    );
    const manager = new CrossDeviceSyncManager(transport, {
      granted_partitions: session.grantedPartitions,
    });
    this.syncManagersByDevice.set(deviceId, manager);
    return manager;
  }

  /** Applies a locally-originated change (desktop-side) into this device's sync channel, so it appears on the phone's next pull. */
  public queueLocalChange(deviceId: string, change: SyncChange): Promise<void> {
    const manager = this.syncManagerFor(deviceId);
    manager.applyLocal(change);
    return manager.flush().then((result) => {
      if (!result.ok) throw new Error(result.error.message);
    });
  }

  private authenticate(request: IncomingMessage): string | undefined {
    const header = request.headers.authorization;
    if (typeof header !== "string" || !header.startsWith("Bearer ")) return undefined;
    return this.options.tokens.deviceFor(header.slice("Bearer ".length));
  }

  private async readJsonBody(request: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.byteLength;
      if (size > 10_000_000) throw new Error("Request body exceeds the 10 MB limit."); // Higher than rest-api.ts's 1 MB — this server also carries base64 camera frames.
      chunks.push(buffer);
    }
    if (chunks.length === 0) return {};
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }

  private send(response: ServerResponse, status: number, body: unknown): void {
    response.statusCode = status;
    response.end(JSON.stringify(body));
  }
}

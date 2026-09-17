import { randomUUID } from "node:crypto";

import { err, ok, type Result } from "@nova/shared";

/**
 * Finishes App Control and File Access as genuinely *remote*
 * capabilities. `AppController.kt` and `FileAccessManager.kt` are
 * real, working local APIs on the phone — what was missing was any
 * way for the Primary Runtime (desktop) to actually reach them. This
 * is that wiring: the desktop enqueues a command for a specific
 * paired device, the phone polls for it (via companion-server.ts,
 * consistent with the "session-scoped, not always-on" foreground
 * service model — the phone is not expected to hold an open push
 * connection at all times), executes it against its already-real
 * local managers, and posts the result back.
 */

export type CompanionCommandAction =
  | { readonly kind: "app_control.open_deep_link"; readonly uri: string }
  | { readonly kind: "app_control.click_by_text"; readonly text: string }
  | { readonly kind: "file_access.list"; readonly tree_uri: string }
  | { readonly kind: "file_access.read"; readonly file_uri: string }
  | {
      readonly kind: "file_access.write";
      readonly directory_tree_uri: string;
      readonly file_name: string;
      readonly mime_type: string;
      readonly content_b64: string;
    };

export interface CompanionCommand {
  readonly command_id: string;
  readonly device_id: string;
  readonly action: CompanionCommandAction;
  readonly issued_at: number;
}

export type CompanionCommandResult =
  | { readonly ok: true; readonly result: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly reason: string };

interface PendingCommand {
  readonly command: CompanionCommand;
  resolve: (result: CompanionCommandResult) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class CompanionCommandBridge {
  private readonly queuedByDevice = new Map<string, CompanionCommand[]>();
  private readonly pending = new Map<string, PendingCommand>();

  /**
   * Enqueues a command for the device and resolves once the device
   * posts a result (or the timeout elapses — a companion device is
   * not always reachable; a polling phone with its screen off or the
   * foreground service stopped should time out cleanly rather than
   * hang the caller indefinitely).
   */
  public sendCommand(
    deviceId: string,
    action: CompanionCommandAction,
    timeoutMs = 30_000,
  ): Promise<Result<CompanionCommandResult>> {
    const command: CompanionCommand = {
      command_id: randomUUID(),
      device_id: deviceId,
      action,
      issued_at: Date.now(),
    };
    const queue = this.queuedByDevice.get(deviceId) ?? [];
    queue.push(command);
    this.queuedByDevice.set(deviceId, queue);

    return new Promise((resolvePromise) => {
      const timeout = setTimeout(() => {
        this.pending.delete(command.command_id);
        resolvePromise(
          err({
            code: "NOVA-NET001",
            message: `Companion device did not respond to command '${command.command_id}' within ${timeoutMs}ms.`,
            retryable: true,
          }),
        );
      }, timeoutMs);

      this.pending.set(command.command_id, {
        command,
        resolve: (result) => {
          clearTimeout(timeout);
          resolvePromise(ok(result));
        },
        reject: (error) => {
          clearTimeout(timeout);
          resolvePromise(err({ code: "NOVA-NET001", message: error.message, retryable: true }));
        },
        timeout,
      });
    });
  }

  /** Called by companion-server.ts when the device polls — removes and returns everything currently queued for it. */
  public takeQueuedCommands(deviceId: string): readonly CompanionCommand[] {
    const queue = this.queuedByDevice.get(deviceId) ?? [];
    this.queuedByDevice.set(deviceId, []);
    return queue;
  }

  /** Called by companion-server.ts when the device posts a result for a command it executed. */
  public submitResult(commandId: string, result: CompanionCommandResult): Result<void> {
    const entry = this.pending.get(commandId);
    if (!entry) {
      return err({
        code: "NOVA-NET001",
        message: "No pending command matches this command_id — it may have already timed out.",
        retryable: false,
      });
    }
    this.pending.delete(commandId);
    entry.resolve(result);
    return ok(undefined);
  }
}

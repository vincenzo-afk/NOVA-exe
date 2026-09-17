import { err, ok, type Result } from "@nova/shared";

import { decryptPayload, encryptPayload, type EncryptedEnvelope } from "./companion-crypto.js";
import type { SyncTransport } from "./cross-device-sync.js";

/**
 * The concrete server-side backing store `cross-device-sync.ts`'s
 * `CrossDeviceSyncManager` needed but never had: an actual append-only
 * log per paired device, and a `SyncTransport` implementation wired
 * against it. Previously `CrossDeviceSyncManager` only ran against
 * injected test doubles — this gives it a real transport.
 *
 * Deliberately a dumb, opaque relay: this store never decrypts an
 * envelope itself, it only appends and returns ciphertext by logical
 * clock. Only the two paired endpoints — desktop and phone, sharing
 * the session key derived at pairing — can actually read a payload,
 * consistent with `companion-crypto.ts`'s payload-level encryption
 * being independent of transport-level trust.
 */

interface LogEntry {
  readonly logical_clock: number;
  readonly envelope: EncryptedEnvelope;
}

export class CompanionSyncBroker {
  private readonly logsByDevice = new Map<string, LogEntry[]>();
  private readonly clocksByDevice = new Map<string, number>();

  /** Appends envelopes to a device's channel, returning the log's new head clock. */
  public push(
    deviceId: string,
    envelopes: readonly EncryptedEnvelope[],
  ): Result<{ next_clock: number }> {
    if (envelopes.length === 0) return ok({ next_clock: this.clocksByDevice.get(deviceId) ?? 0 });
    const log = this.logsByDevice.get(deviceId) ?? [];
    let clock = this.clocksByDevice.get(deviceId) ?? 0;
    for (const envelope of envelopes) {
      clock += 1;
      log.push({ logical_clock: clock, envelope });
    }
    this.logsByDevice.set(deviceId, log);
    this.clocksByDevice.set(deviceId, clock);
    return ok({ next_clock: clock });
  }

  /** Returns every envelope strictly after `sinceLogicalClock` for this device's channel. */
  public pull(
    deviceId: string,
    sinceLogicalClock: number,
  ): Result<{ next_clock: number; envelopes: readonly EncryptedEnvelope[] }> {
    if (!Number.isSafeInteger(sinceLogicalClock) || sinceLogicalClock < 0) {
      return err({
        code: "NOVA-EVT001",
        message: "sinceLogicalClock must be a non-negative integer.",
        retryable: false,
      });
    }
    const log = this.logsByDevice.get(deviceId) ?? [];
    const entries = log.filter((entry) => entry.logical_clock > sinceLogicalClock);
    return ok({
      next_clock: this.clocksByDevice.get(deviceId) ?? 0,
      envelopes: entries.map((entry) => entry.envelope),
    });
  }
}

/**
 * Builds the `SyncTransport` a `CrossDeviceSyncManager` instance
 * needs, wired against [broker] for one specific paired device and
 * encrypting/decrypting every payload with that device's session key.
 * `push`'s envelopes and `pull`'s envelopes are both plain strings at
 * `CrossDeviceSyncManager`'s level (it calls `transport.encrypt`
 * itself before handing them here) — this factory's `pull`/`push`
 * only have to move already-encrypted strings between
 * `CrossDeviceSyncManager` and the broker's `EncryptedEnvelope` shape.
 */
export function createCompanionSyncTransport(
  broker: CompanionSyncBroker,
  deviceId: string,
  sessionKey: Buffer,
): SyncTransport {
  return {
    async pull(sinceLogicalClock: number) {
      const result = broker.pull(deviceId, sinceLogicalClock);
      if (!result.ok) throw new Error(result.error.message);
      return {
        next_clock: result.value.next_clock,
        envelopes: result.value.envelopes.map((envelope) => JSON.stringify(envelope)),
      };
    },
    async push(envelopes: readonly string[]) {
      const parsed = envelopes.map((envelope) => JSON.parse(envelope) as EncryptedEnvelope);
      const result = broker.push(deviceId, parsed);
      if (!result.ok) throw new Error(result.error.message);
    },
    encrypt(payload: string): string {
      return JSON.stringify(encryptPayload(sessionKey, payload));
    },
    decrypt(payload: string): string {
      const result = decryptPayload(sessionKey, JSON.parse(payload) as EncryptedEnvelope);
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
  };
}

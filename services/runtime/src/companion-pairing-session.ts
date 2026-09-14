import { randomBytes } from "node:crypto";

import { err, ok, type Result } from "@nova/shared";

import { deriveSessionKey, signChallenge, type CompanionKeyPair } from "./companion-crypto.js";
import { DevicePairingManager, type PairingOffer, type PairingRequest, type TrustedDevice } from "./device-pairing.js";

/**
 * Wires the already-correct pairing handshake logic
 * (`DevicePairingManager`) to an actual transport session: on
 * successful pairing, derives the AES-256-GCM key both sides will use
 * for every subsequent sync/command/vision payload
 * (`companion-crypto.ts`) and issues the bearer token
 * `companion-server.ts` requires on every authenticated request. This
 * is the piece that turns "the crypto check passes" into "the device
 * now has a working, authenticated, encrypted channel."
 */

export interface CompanionSession {
  readonly deviceId: string;
  readonly token: string;
  readonly sessionKey: Buffer;
  readonly grantedPartitions: Set<string>;
}

/** Device-scoped bearer tokens — deliberately separate from rest-api.ts's LocalApiTokenIssuer, whose ApiScope union is fixed and not meant to carry per-device companion scopes. */
export class CompanionTokenIssuer {
  private readonly tokensByDevice = new Map<string, string>();
  private readonly devicesByToken = new Map<string, string>();

  public issue(deviceId: string): string {
    const existing = this.tokensByDevice.get(deviceId);
    if (existing) this.devicesByToken.delete(existing);
    const token = `nova_companion_${randomBytes(24).toString("hex")}`;
    this.tokensByDevice.set(deviceId, token);
    this.devicesByToken.set(token, deviceId);
    return token;
  }

  public deviceFor(token: string): string | undefined {
    return this.devicesByToken.get(token);
  }

  public revoke(deviceId: string): void {
    const token = this.tokensByDevice.get(deviceId);
    if (token) this.devicesByToken.delete(token);
    this.tokensByDevice.delete(deviceId);
  }
}

export class CompanionSessionStore {
  private readonly sessions = new Map<string, CompanionSession>();

  public set(session: CompanionSession): void {
    this.sessions.set(session.deviceId, session);
  }

  public get(deviceId: string): CompanionSession | undefined {
    return this.sessions.get(deviceId);
  }

  public delete(deviceId: string): void {
    this.sessions.delete(deviceId);
  }

  /**
   * Grants a sync partition to an already-paired device — this is
   * NEVER auto-populated at pairing time. Pairing establishes trust
   * and an encrypted channel; it grants no data-category access by
   * itself, per docs/10-security/permissions.md's individually
   * revocable model. A caller (the Permission Manager's own consent
   * flow) grants partitions explicitly, afterward.
   */
  public grantPartition(deviceId: string, partition: string): Result<void> {
    const session = this.sessions.get(deviceId);
    if (!session) {
      return err({ code: "NOVA-SEC001", message: "No active session for this device.", retryable: false });
    }
    session.grantedPartitions.add(partition);
    return ok(undefined);
  }

  public revokePartition(deviceId: string, partition: string): void {
    this.sessions.get(deviceId)?.grantedPartitions.delete(partition);
  }
}

export class CompanionPairingCoordinator {
  public constructor(
    private readonly pairing: DevicePairingManager,
    private readonly desktopKeyPair: CompanionKeyPair,
    private readonly sessions: CompanionSessionStore,
    private readonly tokens: CompanionTokenIssuer,
  ) {}

  public createOffer(runtimeMode: PairingOffer["runtime_mode"]): Result<PairingOffer> {
    return this.pairing.createOffer({
      runtime_mode: runtimeMode,
      primary_public_key: this.desktopKeyPair.publicKeyB64,
    });
  }

  /**
   * The desktop half of the challenge/response exchange
   * `PairingManager.kt`'s crypto check already assumes exists: the
   * phone generates a random challenge locally
   * (`PairingManager.generateChallenge()`), sends it here over the
   * channel established by the still-open offer, and the desktop
   * signs it with the same private key whose public half is embedded
   * in the QR payload. [channelToken] must match the offer's own
   * token — the device isn't trusted yet at this point in the flow,
   * so the QR-derived token is the only credential available to gate
   * this endpoint against an unrelated caller on the same network.
   */
  public signChallenge(code: string, channelToken: string, challengeB64: string): Result<string> {
    if (!this.pairing.verifyChannelToken(code, channelToken)) {
      return err({ code: "NOVA-SEC001", message: "Invalid or expired pairing channel token.", retryable: false });
    }
    const challenge = Buffer.from(challengeB64, "base64");
    return ok(signChallenge(this.desktopKeyPair.privateKeyB64, challenge));
  }

  public completePairing(
    code: string,
    request: PairingRequest,
  ): Result<{ device: TrustedDevice; token: string }> {
    const paired = this.pairing.completePairing(code, request);
    if (!paired.ok) return paired;

    const sessionKey = deriveSessionKey(this.desktopKeyPair.privateKeyB64, request.device_public_key);
    if (!sessionKey.ok) return sessionKey;

    const token = this.tokens.issue(paired.value.device_id);
    this.sessions.set({
      deviceId: paired.value.device_id,
      token,
      sessionKey: sessionKey.value,
      grantedPartitions: new Set<string>(),
    });
    return ok({ device: paired.value, token });
  }

  public unpair(deviceId: string): Result<void> {
    const result = this.pairing.unpair(deviceId);
    if (!result.ok) return result;
    this.sessions.delete(deviceId);
    this.tokens.revoke(deviceId);
    return ok(undefined);
  }
}

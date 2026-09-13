/**
 * Implements docs/28-multi-device-protocol/05-networking-and-discovery.md's
 * connection lifecycle:
 *
 *   Disconnected -> Discovering -> Pairing (new device only) /
 *   Authenticating (known device) -> Connected -> Healthy <-> Degraded
 *   -> Reconnecting -> Disconnected
 *
 * NOVA doesn't implement its own mesh networking (the doc is explicit
 * that's delegated to a user-configured provider like Tailscale) or
 * mDNS discovery itself — those are injected as collaborators, same
 * pattern as everywhere else this session. What this class owns is the
 * state machine's *correctness*: the two failure modes the doc names
 * for this area are both state-machine bugs, not networking bugs, and
 * both are enforced here rather than left to a caller to remember:
 *
 * - FM-26-014 (Healthy/Degraded "flapping"): a single bad heartbeat
 *   sample never flips the state on its own — degrading and recovering
 *   both require several consecutive samples past the threshold
 *   (hysteresis), configurable but real, not just documented as a good
 *   idea.
 * - FM-26-016 (mDNS name-collision hijack): `authenticate()` is a
 *   separate, mandatory step after `discover()` that checks the
 *   discovered candidate's key against the *stored* pairing key for
 *   that device id — discovery alone is never enough to reach
 *   `Connected`, regardless of how plausible the discovered name looked.
 */

export type ConnectionState =
  | "disconnected"
  | "discovering"
  | "pairing"
  | "authenticating"
  | "connected_healthy"
  | "connected_degraded"
  | "reconnecting";

export interface DiscoveredCandidate {
  readonly deviceId: string;
  readonly advertisedName: string;
  readonly address: string;
}

export interface HeartbeatSample {
  readonly latencyMs: number;
  readonly packetLossPct: number;
}

export interface DeviceConnectionLifecycleOptions {
  /** Consecutive degraded heartbeats required before actually transitioning Healthy -> Degraded. Default 3 — not a doc-mandated number, just a sane hysteresis default. */
  readonly degradeAfterConsecutiveSamples?: number;
  /** Consecutive healthy heartbeats required before transitioning Degraded -> Healthy. Default 3. */
  readonly recoverAfterConsecutiveSamples?: number;
  readonly latencyDegradedThresholdMs?: number;
  readonly packetLossDegradedThresholdPct?: number;
  readonly now?: () => string;
}

export interface StateChange {
  readonly from: ConnectionState;
  readonly to: ConnectionState;
  readonly at: string;
}

const DEFAULT_CONSECUTIVE_SAMPLES = 3;
const DEFAULT_LATENCY_THRESHOLD_MS = 500;
const DEFAULT_PACKET_LOSS_THRESHOLD_PCT = 5;

export class DeviceConnectionLifecycle {
  private state: ConnectionState = "disconnected";
  private consecutiveDegradedSamples = 0;
  private consecutiveHealthySamples = 0;
  private authenticatedDeviceId: string | undefined;
  private readonly transitions: StateChange[] = [];
  private readonly now: () => string;
  private readonly degradeAfter: number;
  private readonly recoverAfter: number;
  private readonly latencyThresholdMs: number;
  private readonly packetLossThresholdPct: number;

  public constructor(options: DeviceConnectionLifecycleOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.degradeAfter = options.degradeAfterConsecutiveSamples ?? DEFAULT_CONSECUTIVE_SAMPLES;
    this.recoverAfter = options.recoverAfterConsecutiveSamples ?? DEFAULT_CONSECUTIVE_SAMPLES;
    this.latencyThresholdMs = options.latencyDegradedThresholdMs ?? DEFAULT_LATENCY_THRESHOLD_MS;
    this.packetLossThresholdPct = options.packetLossDegradedThresholdPct ?? DEFAULT_PACKET_LOSS_THRESHOLD_PCT;
  }

  public currentState(): ConnectionState {
    return this.state;
  }

  public history(): readonly StateChange[] {
    return this.transitions;
  }

  public beginDiscovery(): void {
    this.transitionTo("discovering");
  }

  /**
   * A discovery mechanism (mDNS, mesh-provider lookup) found a
   * candidate. This alone never reaches `Connected` — see FM-26-016 in
   * this file's top comment; `authenticate()` is mandatory next.
   */
  public candidateDiscovered(isKnownDevice: boolean): void {
    if (this.state !== "discovering") {
      throw new Error(`Cannot record a discovered candidate from state '${this.state}'.`);
    }
    this.transitionTo(isKnownDevice ? "authenticating" : "pairing");
  }

  /** New-device path: pairing succeeded (see entity/device pairing protocol, not this file's concern) — authenticate next, same as a known device now would. */
  public pairingSucceeded(): void {
    if (this.state !== "pairing") throw new Error(`Cannot complete pairing from state '${this.state}'.`);
    this.transitionTo("authenticating");
  }

  /**
   * Verifies the discovered candidate's key against the stored pairing
   * key for `expectedDeviceId` — the FM-26-016 check. Returns whether
   * authentication succeeded; on failure the state machine returns to
   * `disconnected` rather than silently trusting a name match.
   */
  public authenticate(candidate: DiscoveredCandidate, storedKeysByDeviceId: ReadonlyMap<string, string>, presentedKey: string): boolean {
    if (this.state !== "authenticating") {
      throw new Error(`Cannot authenticate from state '${this.state}'.`);
    }
    const expectedKey = storedKeysByDeviceId.get(candidate.deviceId);
    if (expectedKey === undefined || expectedKey !== presentedKey) {
      this.transitionTo("disconnected");
      return false;
    }
    this.authenticatedDeviceId = candidate.deviceId;
    this.consecutiveDegradedSamples = 0;
    this.consecutiveHealthySamples = 0;
    this.transitionTo("connected_healthy");
    return true;
  }

  /**
   * Feeds one heartbeat sample. Only flips Healthy<->Degraded after
   * `degradeAfter`/`recoverAfter` consecutive samples past the
   * threshold — the FM-26-014 hysteresis. A sample outside either
   * `connected_healthy`/`connected_degraded` is ignored rather than
   * throwing, since heartbeats can legitimately arrive slightly before
   * a state transition is processed.
   */
  public recordHeartbeat(sample: HeartbeatSample): void {
    if (this.state !== "connected_healthy" && this.state !== "connected_degraded") return;
    const isBad =
      sample.latencyMs >= this.latencyThresholdMs || sample.packetLossPct >= this.packetLossThresholdPct;

    if (isBad) {
      this.consecutiveDegradedSamples += 1;
      this.consecutiveHealthySamples = 0;
      if (this.state === "connected_healthy" && this.consecutiveDegradedSamples >= this.degradeAfter) {
        this.transitionTo("connected_degraded");
      }
    } else {
      this.consecutiveHealthySamples += 1;
      this.consecutiveDegradedSamples = 0;
      if (this.state === "connected_degraded" && this.consecutiveHealthySamples >= this.recoverAfter) {
        this.transitionTo("connected_healthy");
      }
    }
  }

  /**
   * An actual connection loss (not merely degraded quality — see this
   * file's top comment on why those are different transitions).
   */
  public connectionLost(): void {
    if (this.state !== "connected_healthy" && this.state !== "connected_degraded") {
      throw new Error(`Cannot lose a connection from state '${this.state}'.`);
    }
    this.transitionTo("reconnecting");
  }

  public reconnected(): void {
    if (this.state !== "reconnecting") throw new Error(`Cannot complete a reconnect from state '${this.state}'.`);
    this.consecutiveDegradedSamples = 0;
    this.consecutiveHealthySamples = 0;
    this.transitionTo("connected_healthy");
  }

  public reconnectAbandoned(): void {
    if (this.state !== "reconnecting") throw new Error(`Cannot abandon a reconnect from state '${this.state}'.`);
    this.authenticatedDeviceId = undefined;
    this.transitionTo("disconnected");
  }

  private transitionTo(next: ConnectionState): void {
    this.transitions.push({ from: this.state, to: next, at: this.now() });
    this.state = next;
  }
}

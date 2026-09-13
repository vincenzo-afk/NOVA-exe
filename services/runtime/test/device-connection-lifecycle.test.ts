import { describe, expect, it } from "vitest";
import { DeviceConnectionLifecycle } from "../src/device-connection-lifecycle.js";

const candidate = { deviceId: "phone-1", advertisedName: "Alex's Phone", address: "10.0.0.5" };

describe("DeviceConnectionLifecycle", () => {
  it("walks the full known-device happy path: discovering -> authenticating -> connected", () => {
    const lifecycle = new DeviceConnectionLifecycle();
    lifecycle.beginDiscovery();
    lifecycle.candidateDiscovered(true);

    expect(lifecycle.currentState()).toBe("authenticating");

    const authenticated = lifecycle.authenticate(candidate, new Map([["phone-1", "correct-key"]]), "correct-key");

    expect(authenticated).toBe(true);
    expect(lifecycle.currentState()).toBe("connected_healthy");
  });

  it("routes a never-before-seen device through pairing before authenticating", () => {
    const lifecycle = new DeviceConnectionLifecycle();
    lifecycle.beginDiscovery();
    lifecycle.candidateDiscovered(false);
    expect(lifecycle.currentState()).toBe("pairing");

    lifecycle.pairingSucceeded();
    expect(lifecycle.currentState()).toBe("authenticating");
  });

  it("FM-26-016: rejects a discovered candidate whose presented key doesn't match the stored key, even with a plausible name", () => {
    const lifecycle = new DeviceConnectionLifecycle();
    lifecycle.beginDiscovery();
    lifecycle.candidateDiscovered(true);

    const authenticated = lifecycle.authenticate(
      candidate,
      new Map([["phone-1", "correct-key"]]),
      "wrong-key-from-impostor-device",
    );

    expect(authenticated).toBe(false);
    expect(lifecycle.currentState()).toBe("disconnected");
  });

  it("FM-26-016: rejects authentication against a device id with no stored key at all", () => {
    const lifecycle = new DeviceConnectionLifecycle();
    lifecycle.beginDiscovery();
    lifecycle.candidateDiscovered(true);

    expect(lifecycle.authenticate(candidate, new Map(), "any-key")).toBe(false);
  });

  it("FM-26-014: a single bad heartbeat does not flip Healthy to Degraded", () => {
    const lifecycle = new DeviceConnectionLifecycle();
    connectDevice(lifecycle);

    lifecycle.recordHeartbeat({ latencyMs: 900, packetLossPct: 0 });

    expect(lifecycle.currentState()).toBe("connected_healthy");
  });

  it("FM-26-014: degrades only after the configured number of consecutive bad samples, and recovers the same way", () => {
    const lifecycle = new DeviceConnectionLifecycle({
      degradeAfterConsecutiveSamples: 2,
      recoverAfterConsecutiveSamples: 2,
    });
    connectDevice(lifecycle);

    lifecycle.recordHeartbeat({ latencyMs: 900, packetLossPct: 0 });
    expect(lifecycle.currentState()).toBe("connected_healthy");
    lifecycle.recordHeartbeat({ latencyMs: 900, packetLossPct: 0 });
    expect(lifecycle.currentState()).toBe("connected_degraded");

    lifecycle.recordHeartbeat({ latencyMs: 10, packetLossPct: 0 });
    expect(lifecycle.currentState()).toBe("connected_degraded");
    lifecycle.recordHeartbeat({ latencyMs: 10, packetLossPct: 0 });
    expect(lifecycle.currentState()).toBe("connected_healthy");
  });

  it("FM-26-014: an interleaved good sample resets the degraded streak instead of accumulating across gaps", () => {
    const lifecycle = new DeviceConnectionLifecycle({ degradeAfterConsecutiveSamples: 3 });
    connectDevice(lifecycle);

    lifecycle.recordHeartbeat({ latencyMs: 900, packetLossPct: 0 });
    lifecycle.recordHeartbeat({ latencyMs: 900, packetLossPct: 0 });
    lifecycle.recordHeartbeat({ latencyMs: 10, packetLossPct: 0 }); // resets the streak
    lifecycle.recordHeartbeat({ latencyMs: 900, packetLossPct: 0 });

    expect(lifecycle.currentState()).toBe("connected_healthy");
  });

  it("distinguishes an actual connection loss from mere degradation — only connectionLost() reaches Reconnecting", () => {
    const lifecycle = new DeviceConnectionLifecycle({ degradeAfterConsecutiveSamples: 1 });
    connectDevice(lifecycle);
    lifecycle.recordHeartbeat({ latencyMs: 900, packetLossPct: 0 });
    expect(lifecycle.currentState()).toBe("connected_degraded");

    lifecycle.connectionLost();
    expect(lifecycle.currentState()).toBe("reconnecting");
  });

  it("reconnecting resolves to either connected_healthy or disconnected, never silently stuck", () => {
    const lifecycle = new DeviceConnectionLifecycle();
    connectDevice(lifecycle);
    lifecycle.connectionLost();

    lifecycle.reconnected();
    expect(lifecycle.currentState()).toBe("connected_healthy");
  });

  it("records every transition with a timestamp, in order", () => {
    const timestamps = ["t0", "t1", "t2"];
    let i = 0;
    const lifecycle = new DeviceConnectionLifecycle({ now: () => timestamps[i++] });
    lifecycle.beginDiscovery();
    lifecycle.candidateDiscovered(true);
    lifecycle.authenticate(candidate, new Map([["phone-1", "k"]]), "k");

    expect(lifecycle.history()).toEqual([
      { from: "disconnected", to: "discovering", at: "t0" },
      { from: "discovering", to: "authenticating", at: "t1" },
      { from: "authenticating", to: "connected_healthy", at: "t2" },
    ]);
  });

  it("rejects an out-of-order transition instead of silently accepting it", () => {
    const lifecycle = new DeviceConnectionLifecycle();
    expect(() => lifecycle.authenticate(candidate, new Map(), "k")).toThrow(/Cannot authenticate/);
  });
});

function connectDevice(lifecycle: DeviceConnectionLifecycle): void {
  lifecycle.beginDiscovery();
  lifecycle.candidateDiscovered(true);
  lifecycle.authenticate(candidate, new Map([["phone-1", "k"]]), "k");
}

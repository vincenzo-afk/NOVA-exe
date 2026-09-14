import { describe, expect, it } from "vitest";

import { CompanionCommandBridge } from "../src/companion-command-bridge.js";

describe("CompanionCommandBridge", () => {
  it("delivers a queued command to the device's next poll and resolves sendCommand once a result is submitted", async () => {
    const bridge = new CompanionCommandBridge();

    const pending = bridge.sendCommand("android-1", { kind: "app_control.click_by_text", text: "Send" });
    const queued = bridge.takeQueuedCommands("android-1");
    expect(queued).toHaveLength(1);
    expect(queued[0]?.action).toMatchObject({ kind: "app_control.click_by_text", text: "Send" });

    const submitted = bridge.submitResult(queued[0]!.command_id, { ok: true, result: { via: "accessibility_service" } });
    expect(submitted.ok).toBe(true);

    const result = await pending;
    expect(result).toMatchObject({ ok: true, value: { ok: true, result: { via: "accessibility_service" } } });
  });

  it("times out cleanly when the device never polls or never responds", async () => {
    const bridge = new CompanionCommandBridge();

    const result = await bridge.sendCommand("android-1", { kind: "file_access.list", tree_uri: "content://tree" }, 10);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOVA-NET001");
    expect(result.error.retryable).toBe(true);
  });

  it("rejects a result submitted for an unknown or already-resolved command_id", () => {
    const bridge = new CompanionCommandBridge();

    const result = bridge.submitResult("does-not-exist", { ok: true, result: {} });

    expect(result.ok).toBe(false);
  });

  it("queues are per-device and taking a queue drains it", () => {
    const bridge = new CompanionCommandBridge();
    void bridge.sendCommand("android-1", { kind: "file_access.list", tree_uri: "content://tree" }, 10);

    expect(bridge.takeQueuedCommands("android-2")).toHaveLength(0);
    expect(bridge.takeQueuedCommands("android-1")).toHaveLength(1);
    expect(bridge.takeQueuedCommands("android-1")).toHaveLength(0);
  });
});

import { describe, expect, it, vi } from "vitest";
import { StateManager } from "../src/state-manager.js";

describe("StateManager", () => {
  const observation = (overrides: Partial<Parameters<StateManager["observe"]>[0]> = {}) => ({
    entityRef: "file:/workspace/report.txt",
    value: { exists: true },
    observer: "filesystem",
    observedAt: "2026-08-21T10:00:00.000Z",
    confidence: 0.9,
    corroborated: false,
    ...overrides,
  });

  it("returns the latest observation with its confidence", async () => {
    const manager = new StateManager();
    manager.observe(observation());

    const result = await manager.query({
      entityRef: "file:/workspace/report.txt",
      allowActiveRecheck: false,
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        value: { exists: true },
        confidence: 0.9,
        contradictionPending: false,
      },
    });
  });

  it("marks a disagreement from independent observers as provisional within five seconds", async () => {
    const manager = new StateManager();
    manager.observe(observation());
    manager.observe(
      observation({
        value: { exists: false },
        observer: "browser",
        observedAt: "2026-08-21T10:00:03.000Z",
        confidence: 0.6,
      }),
    );

    const result = await manager.query({
      entityRef: "file:/workspace/report.txt",
      allowActiveRecheck: false,
    });

    expect(result).toMatchObject({ ok: true, value: { contradictionPending: true } });
  });

  it("resolves a contradiction through the active re-check when permitted", async () => {
    const recheck = vi.fn(async () => ({ exists: true }));
    const manager = new StateManager(recheck);
    manager.observe(observation());
    manager.observe(
      observation({
        value: { exists: false },
        observer: "browser",
        observedAt: "2026-08-21T10:00:03.000Z",
        confidence: 0.6,
      }),
    );

    const result = await manager.query({
      entityRef: "file:/workspace/report.txt",
      allowActiveRecheck: true,
    });

    expect(recheck).toHaveBeenCalledWith("file:/workspace/report.txt");
    expect(result).toMatchObject({
      ok: true,
      value: { value: { exists: true }, contradictionPending: false },
    });
  });

  it("persists the active-recheck result at full confidence, not the stale contested observation's confidence, and a later query doesn't re-flag the contradiction", async () => {
    const recheck = vi.fn(async () => ({ exists: true }));
    const manager = new StateManager(recheck);
    manager.observe(observation({ confidence: 0.5 }));
    manager.observe(
      observation({
        value: { exists: false },
        observer: "browser",
        observedAt: "2026-08-21T10:00:03.000Z",
        confidence: 0.6,
      }),
    );

    const rechecked = await manager.query({
      entityRef: "file:/workspace/report.txt",
      allowActiveRecheck: true,
    });
    expect(rechecked).toMatchObject({
      ok: true,
      value: { confidence: 1, contradictionPending: false },
    });

    // A second query, even without permission to recheck again, should
    // see the persisted recheck result and not resurrect the old
    // contradiction between the two stale observations.
    expect(recheck).toHaveBeenCalledTimes(1);
    const followUp = await manager.query({
      entityRef: "file:/workspace/report.txt",
      allowActiveRecheck: false,
    });
    expect(followUp).toMatchObject({
      ok: true,
      value: { value: { exists: true }, confidence: 1, contradictionPending: false },
    });
    expect(recheck).toHaveBeenCalledTimes(1);
  });

  it("does not treat disagreements outside the conflict window as provisional", async () => {
    const manager = new StateManager();
    manager.observe(observation());
    manager.observe(
      observation({
        value: { exists: false },
        observer: "browser",
        observedAt: "2026-08-21T10:00:06.000Z",
        confidence: 0.6,
      }),
    );

    const result = await manager.query({
      entityRef: "file:/workspace/report.txt",
      allowActiveRecheck: false,
    });

    expect(result).toMatchObject({
      ok: true,
      value: { contradictionPending: false, value: { exists: false } },
    });
  });

  it("returns a stable error for an unknown entity", async () => {
    const manager = new StateManager();

    const result = await manager.query({
      entityRef: "file:/missing.txt",
      allowActiveRecheck: false,
    });

    expect(result).toMatchObject({ ok: false, error: { code: "NOVA-CFG001", retryable: false } });
  });
});

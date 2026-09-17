import { describe, expect, it } from "vitest";

import { KnowledgeGraph } from "../src/knowledge-graph.js";
import { SpatialContext, type ObjectObservation } from "../src/spatial-context.js";
import type { SemanticMatcher } from "../src/entity-resolution.js";

const noMatches: SemanticMatcher = () => [];

function observation(overrides: Partial<ObjectObservation> = {}): ObjectObservation {
  return {
    label: "coffee mug",
    description: "a white ceramic coffee mug on the desk",
    observedAtEpochMs: 1_000,
    sourceDeviceId: "android-1",
    ...overrides,
  };
}

describe("SpatialContext", () => {
  it("creates a new PhysicalObject node for a first-time observation", () => {
    const graph = new KnowledgeGraph();
    const context = new SpatialContext(graph, noMatches);

    const match = context.observe(observation());

    expect(match.via).toBe("created_new");
    expect(match.node.type).toBe("PhysicalObject");
    expect(graph.getNode(match.node.id)).toMatchObject({ ok: true });
  });

  it("resolves a second observation of the same label within the continuity window to the same node", () => {
    const graph = new KnowledgeGraph();
    const context = new SpatialContext(graph, noMatches);

    const first = context.observe(observation({ observedAtEpochMs: 1_000 }));
    const second = context.observe(observation({ observedAtEpochMs: 3_000 }));

    expect(second.via).toBe("recent_frame_continuity");
    expect(second.node.id).toBe(first.node.id);
  });

  it("resolveReference finds the most recently observed matching entity without a new observation", () => {
    const graph = new KnowledgeGraph();
    const context = new SpatialContext(graph, noMatches);
    context.observe(observation({ label: "coffee mug", observedAtEpochMs: 1_000 }));
    context.observe(
      observation({
        label: "notebook",
        description: "a spiral notebook",
        observedAtEpochMs: 2_000,
      }),
    );

    const found = context.resolveReference("mug");

    expect(found?.name).toBe("coffee mug");
  });

  it("decays and eventually prunes an entry that stops being observed", () => {
    const graph = new KnowledgeGraph();
    const context = new SpatialContext(graph, noMatches, { windowMs: 5_000, decayPerTick: 1 });
    context.observe(observation({ observedAtEpochMs: 0 }));

    context.tick(1_000);
    context.tick(6_000);

    expect(context.snapshot().length).toBe(0);
  });

  it("converges a camera-identified object with an existing high-confidence semantic match instead of creating a duplicate", () => {
    const graph = new KnowledgeGraph();
    const existing = graph.addNode({
      id: "physobj_existing",
      type: "PhysicalObject",
      name: "my mug",
      properties: {},
      active: true,
    });
    expect(existing.ok).toBe(true);
    const semanticMatch: SemanticMatcher = (_mention, candidates) =>
      candidates.map((node) => ({ node, confidence: 0.9 }));
    const context = new SpatialContext(graph, semanticMatch);

    const match = context.observe(observation({ observedAtEpochMs: 50_000 }));

    expect(match.via).toBe("resolved_semantic");
    expect(match.node.id).toBe("physobj_existing");
  });
});

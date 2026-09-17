import type { GraphNode } from "./knowledge-graph.js";
import type { KnowledgeGraph } from "./knowledge-graph.js";
import { EntityResolver, type SemanticMatcher } from "./entity-resolution.js";

/**
 * Implements docs/20-devices/spatial-perception.md's SpatialContext:
 * the vision analog of entity-resolution.md's text-mention pipeline,
 * reusing EntityResolver and KnowledgeGraph directly rather than a
 * parallel matching system — an object identified through the camera
 * and the same object mentioned later in chat converge on one graph
 * node because they resolve through the identical resolver.
 *
 * This is deliberately NOT a general 3D/depth spatial model — per the
 * doc's scope boundary, it is 2D-frame object/scene identification
 * plus relative-position inference from framing, converged into
 * durable entities and given short-lived cross-frame continuity so
 * "that thing from a second ago" resolves without re-sending frame
 * history on every turn.
 */

export interface ObjectObservation {
  /** A short label from the vision provider, e.g. "coffee mug" — the "mention" this observation resolves as an entity. */
  readonly label: string;
  /** A fuller natural-language description used for semantic matching against existing PhysicalObject nodes. */
  readonly description: string;
  /** Normalized (0..1) bounding box within the frame, when the provider supplies one — used only for the same-frame vs. moved heuristic below, never as a 3D position. */
  readonly boundingBox?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly observedAtEpochMs: number;
  readonly sourceDeviceId: string;
}

export interface SpatialMatch {
  readonly node: GraphNode;
  readonly via: "resolved_exact" | "resolved_semantic" | "created_new" | "recent_frame_continuity";
}

interface WindowEntry {
  readonly node: GraphNode;
  observation: ObjectObservation;
  lastSeenAtEpochMs: number;
  confidence: number;
}

export interface SpatialContextOptions {
  /** How long an unseen entry stays in the sliding window before it's pruned — a bounded buffer, never an accumulating log, per world-model.md's rolling-window precedent. */
  readonly windowMs?: number;
  /** Per-tick confidence decay applied to an entry not re-corroborated by a fresh observation, per docs/04-memory/memory-confidence.md's staleness model. */
  readonly decayPerTick?: number;
  readonly idGenerator?: () => string;
}

let fallbackCounter = 0;

export class SpatialContext {
  private readonly resolver: EntityResolver;
  private readonly window: WindowEntry[] = [];
  private readonly windowMs: number;
  private readonly decayPerTick: number;
  private readonly idGenerator: () => string;

  public constructor(
    private readonly graph: KnowledgeGraph,
    semanticMatcher: SemanticMatcher,
    options: SpatialContextOptions = {},
  ) {
    this.resolver = new EntityResolver(graph, semanticMatcher);
    this.windowMs = options.windowMs ?? 5 * 60_000;
    this.decayPerTick = options.decayPerTick ?? 0.15;
    this.idGenerator =
      options.idGenerator ?? (() => `physobj_${Date.now()}_${(fallbackCounter += 1)}`);
  }

  /**
   * Resolves one observation against the recent frame window first
   * (cheap, no graph query — "that thing from a second ago"), then
   * falls through to the full EntityResolver pipeline the same way a
   * text mention would, converging into the same graph nodes.
   */
  public observe(observation: ObjectObservation): SpatialMatch {
    const continuity = this.matchRecentFrame(observation);
    if (continuity) {
      continuity.observation = observation;
      continuity.lastSeenAtEpochMs = observation.observedAtEpochMs;
      continuity.confidence = Math.min(1, continuity.confidence + 0.2);
      return { node: continuity.node, via: "recent_frame_continuity" };
    }

    const resolution = this.resolver.resolve(observation.description, "PhysicalObject");
    let node: GraphNode;
    let via: SpatialMatch["via"];
    if (resolution.outcome === "resolved") {
      node = resolution.node;
      via = resolution.via === "exact_match" ? "resolved_exact" : "resolved_semantic";
    } else {
      const created = this.graph.addNode({
        id: this.idGenerator(),
        type: "PhysicalObject",
        name: observation.label,
        properties: {
          description: observation.description,
          source_device_id: observation.sourceDeviceId,
        },
        active: true,
        aliases: [observation.description],
      });
      if (!created.ok) {
        // Ontology/id conflict — extremely unlikely given a fresh generated id, but this
        // path must never throw; fall back to treating it as an unmatched ambiguous case
        // rather than crashing frame processing.
        return { node: this.placeholderNode(observation), via: "created_new" };
      }
      node = created.value;
      via = "created_new";
    }

    this.window.push({
      node,
      observation,
      lastSeenAtEpochMs: observation.observedAtEpochMs,
      confidence: 0.8,
    });
    return { node, via };
  }

  /** Applies staleness decay and prunes entries older than [windowMs] — call once per capture tick, not per observation. */
  public tick(nowEpochMs: number): void {
    for (const entry of this.window) {
      if (entry.lastSeenAtEpochMs !== nowEpochMs)
        entry.confidence = Math.max(0, entry.confidence - this.decayPerTick);
    }
    while (this.window.length > 0) {
      const first = this.window[0];
      if (!first || nowEpochMs - first.lastSeenAtEpochMs <= this.windowMs) break;
      this.window.shift();
    }
  }

  /** Resolves a bare reference ("that thing", "the mug") against the current window without a new observation — the mechanism behind cross-turn references. */
  public resolveReference(hint: string): GraphNode | undefined {
    const candidates = this.window
      .filter((entry) => entry.confidence > 0)
      .filter(
        (entry) =>
          entry.observation.label.toLowerCase().includes(hint.toLowerCase()) ||
          hint.trim().length === 0,
      )
      .sort((a, b) => b.lastSeenAtEpochMs - a.lastSeenAtEpochMs);
    return candidates[0]?.node;
  }

  public snapshot(): readonly { readonly node: GraphNode; readonly confidence: number }[] {
    return this.window.map((entry) => ({ node: entry.node, confidence: entry.confidence }));
  }

  private matchRecentFrame(observation: ObjectObservation): WindowEntry | undefined {
    return this.window.find(
      (entry) =>
        entry.confidence > 0.3 &&
        entry.observation.label.toLowerCase() === observation.label.toLowerCase() &&
        observation.observedAtEpochMs - entry.lastSeenAtEpochMs < 15_000,
    );
  }

  private placeholderNode(observation: ObjectObservation): GraphNode {
    return {
      id: this.idGenerator(),
      type: "PhysicalObject",
      name: observation.label,
      properties: { description: observation.description },
      active: false,
    };
  }
}

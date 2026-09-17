import type { GraphNode, GraphNodeType, KnowledgeGraph } from "./knowledge-graph.js";

/**
 * Implements docs/04-memory/entity-resolution.md's resolution pipeline:
 * exact identifier match -> high-confidence semantic/alias match ->
 * ambiguity-resolution handoff -> new node, with alias tracking so a
 * mention that previously resolved semantically resolves via the exact
 * match step next time.
 *
 * Semantic similarity scoring itself is injected rather than computed
 * here: the doc explicitly separates this flow's job (deciding what to
 * do with a confidence score) from where that score comes from
 * ("the underlying confidence computation is defined [in
 * docs/04-memory/memory-ranking.md]"). A real scorer backed by an
 * embedding model can be substituted without changing this class.
 */

/** docs/04-memory/memory-ranking.md's ambiguity margin, reused here per entity-resolution.md. */
export const AMBIGUITY_MARGIN = 0.1;
/** Conservative by design — see entity-resolution.md "Avoiding false merges". Configurable. */
export const HIGH_CONFIDENCE_THRESHOLD = 0.75;
/** Below this, a candidate isn't plausible enough to route to disambiguation at all. */
export const PLAUSIBLE_CANDIDATE_THRESHOLD = 0.4;

export type SemanticMatcher = (
  mention: string,
  candidates: readonly GraphNode[],
) => ReadonlyArray<{ readonly node: GraphNode; readonly confidence: number }>;

export interface ResolvedEntity {
  readonly outcome: "resolved";
  readonly node: GraphNode;
  readonly via: "exact_match" | "high_confidence_match";
}

export interface AmbiguousEntity {
  readonly outcome: "ambiguous";
  readonly candidates: ReadonlyArray<{ readonly node: GraphNode; readonly confidence: number }>;
}

export interface NewEntity {
  readonly outcome: "create_new";
  /** True when this follows the "still ambiguous" dashed path — the new node should be flagged for merge review. */
  readonly flagForMergeReview: boolean;
}

export type EntityResolution = ResolvedEntity | AmbiguousEntity | NewEntity;

export class EntityResolver {
  public constructor(
    private readonly graph: KnowledgeGraph,
    private readonly semanticMatcher: SemanticMatcher,
  ) {}

  /**
   * Runs the resolution pipeline for a single mention. Does not create
   * or mutate any node itself except recording an alias on a
   * successful semantic resolution — node creation for a `create_new`
   * outcome is the caller's responsibility (it owns id generation and
   * initial properties), consistent with `KnowledgeGraph.addNode`'s
   * existing contract elsewhere in this file.
   */
  resolve(mention: string, type?: GraphNodeType): EntityResolution {
    const exact = this.graph.findByExactMatch(mention, type);
    if (exact) return { outcome: "resolved", node: exact, via: "exact_match" };

    const candidates = this.semanticMatcher(mention, this.graph.activeNodes(type));
    const ranked = [...candidates].sort((a, b) => b.confidence - a.confidence);
    const top = ranked[0];
    const runnerUp = ranked[1];

    if (top && top.confidence >= HIGH_CONFIDENCE_THRESHOLD) {
      const gap = runnerUp ? top.confidence - runnerUp.confidence : 1;
      if (gap >= AMBIGUITY_MARGIN) {
        this.graph.addAlias(top.node.id, mention);
        return { outcome: "resolved", node: top.node, via: "high_confidence_match" };
      }
    }

    const plausible = ranked.filter(
      (candidate) => candidate.confidence >= PLAUSIBLE_CANDIDATE_THRESHOLD,
    );
    if (plausible.length > 1) {
      return { outcome: "ambiguous", candidates: plausible };
    }

    return { outcome: "create_new", flagForMergeReview: false };
  }

  /**
   * Called when the ambiguity-resolution flow (docs/05-ai/ambiguity-resolution.md)
   * comes back still unresolved after an `"ambiguous"` outcome above —
   * entity-resolution.md's dashed "Still ambiguous" path: create a new
   * node rather than guess, but flag it for later merge review instead
   * of treating it as a confirmed distinct entity.
   */
  static stillAmbiguous(): NewEntity {
    return { outcome: "create_new", flagForMergeReview: true };
  }
}

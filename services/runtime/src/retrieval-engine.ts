import { ok, type Result } from "@nova/shared";
import type { MemoryStore, MemorySearchInput, MemoryRecordSummary } from "@nova/memory";

import type { KnowledgeGraph } from "./knowledge-graph.js";
import type { RetrievalCandidate } from "./knowledge-graph.js";
import {
  RetrievalFusion,
  type RankedRetrievalResult,
  type RetrievalBranch,
  type RetrievalBranchResult,
} from "./retrieval-fusion.js";
import { tokenize, diceCoefficient } from "./semantic-matcher.js";

/**
 * `RetrievalFusion.fuse()` was always correct — real weighted math,
 * real tests. What never existed was anything that actually produced
 * the five `RetrievalBranchResult`s it fuses; nothing called it in
 * production. This is that missing piece: real per-branch scores
 * computed from `MemoryStore`'s actual records and (optionally)
 * `KnowledgeGraph`'s actual edges, not five copies of the same
 * substring check relabeled as five branches.
 *
 * Each branch is a genuinely distinct signal, not a renamed
 * duplicate of another:
 * - **keyword** — recall: what fraction of the query's own terms
 *   appear verbatim in the record.
 * - **semantic** — Dice/F1-style token overlap, more forgiving of
 *   partial or reordered matches than keyword recall. A real
 *   embedding-based measure (`semantic-matcher.ts`'s
 *   `createEmbeddingSemanticMatcher`) is a direct drop-in upgrade to
 *   this branch specifically once an embeddings provider is
 *   registered; nothing else in this engine needs to change for that.
 * - **graph** — whether the record's text mentions an entity that is
 *   the query's own matched entity or one hop away from it in the
 *   Knowledge Graph. Requires a `KnowledgeGraph` to be supplied;
 *   scores 0 for every candidate otherwise, never a guessed value.
 * - **temporal** — recency decay from the record's own timestamp.
 * - **entity** — whether the record's text mentions the query's own
 *   directly-matched entity (distinct from graph's one-hop-neighbor
 *   signal).
 */

export interface RetrievalEngineOptions {
  readonly memoryStore: MemoryStore;
  readonly graph?: KnowledgeGraph;
  readonly now?: () => number;
  /** Half-life, in ms, for the temporal branch's recency decay. Defaults to 30 days. */
  readonly temporalHalfLifeMs?: number;
}

const ALL_BRANCHES: readonly RetrievalBranch[] = [
  "semantic", "keyword", "graph", "temporal", "entity",
];

export class RetrievalEngine {
  private readonly fusion = new RetrievalFusion();
  private readonly now: () => number;
  private readonly temporalHalfLifeMs: number;

  public constructor(private readonly options: RetrievalEngineOptions) {
    this.now = options.now ?? (() => Date.now());
    this.temporalHalfLifeMs = options.temporalHalfLifeMs ?? 30 * 24 * 60 * 60 * 1000;
  }

  public async retrieve(
    query: string,
    filters?: MemorySearchInput["filters"],
  ): Promise<Result<readonly RankedRetrievalResult[]>> {
    const listed = await this.options.memoryStore.listCandidates(filters);
    if (!listed.ok) return listed;

    const queryTokens = tokenize(query);
    const { primaryMatches, neighborNames } = this.matchQueryEntities(queryTokens);

    const candidates = listed.value.map((record) =>
      this.scoreRecord(record, queryTokens, primaryMatches, neighborNames, filters),
    );

    const branches: readonly RetrievalBranchResult[] = ALL_BRANCHES.map((branch) => ({
      branch,
      candidates,
    }));
    return ok(this.fusion.fuse(branches));
  }

  private matchQueryEntities(
    queryTokens: readonly string[],
  ): { readonly primaryMatches: readonly string[]; readonly neighborNames: ReadonlySet<string> } {
    const graph = this.options.graph;
    if (!graph) return { primaryMatches: [], neighborNames: new Set() };

    const primaryMatches: string[] = [];
    const neighborNames = new Set<string>();
    for (const node of graph.activeNodes()) {
      if (diceCoefficient(queryTokens, tokenize(node.name)) < 0.4) continue;
      primaryMatches.push(node.name.toLowerCase());
      for (const neighbor of graph.neighbors(node.id)) {
        neighborNames.add(neighbor.name.toLowerCase());
      }
    }
    return { primaryMatches, neighborNames };
  }

  private scoreRecord(
    record: MemoryRecordSummary,
    queryTokens: readonly string[],
    primaryEntityMatches: readonly string[],
    neighborEntityNames: ReadonlySet<string>,
    filters?: MemorySearchInput["filters"],
  ): RetrievalCandidate {
    const contentTokens = tokenize(record.content_ref);
    const contentLower = record.content_ref.toLocaleLowerCase();

    const keywordScore = keywordRecall(queryTokens, contentTokens);
    const semanticScore = diceCoefficient(queryTokens, contentTokens);
    const entityScore = primaryEntityMatches.some((name) => contentLower.includes(name)) ? 1 : 0;
    const graphScore = [...neighborEntityNames].some((name) => contentLower.includes(name)) ? 1 : 0;
    const ageMs = Math.max(0, this.now() - Date.parse(record.created_at));
    const temporalScore = Math.pow(0.5, ageMs / this.temporalHalfLifeMs);

    return {
      id: record.record_id,
      content: record.content_ref,
      semantic_score: semanticScore,
      keyword_score: keywordScore,
      graph_score: graphScore,
      temporal_score: temporalScore,
      entity_score: entityScore,
      // No per-record importance/usage-frequency/pinning signal is tracked by
      // MemoryStore today — these stay neutral defaults rather than invented
      // values, and are genuine follow-up work (docs/04-memory/memory-ranking.md
      // already specs these as populated candidate-level factors).
      importance: 0.5,
      recency: temporalScore,
      confidence: record.confidence ?? 0.5,
      relationship_distance: graphScore > 0 ? 1 : entityScore > 0 ? 0 : Number.POSITIVE_INFINITY,
      usage_frequency: 0,
      pinned: false,
      project_relevance: filters?.project && contentLower.includes(filters.project.toLowerCase()) ? 1 : 0,
      inactive: record.status === "SUPERSEDED" && filters?.include_superseded !== true,
    };
  }
}

/** Fraction of the query's own tokens that appear verbatim in the candidate — recall-oriented, distinct from semantic's symmetric Dice overlap. */
function keywordRecall(queryTokens: readonly string[], contentTokens: readonly string[]): number {
  if (queryTokens.length === 0) return 0;
  const contentSet = new Set(contentTokens);
  const matched = queryTokens.filter((token) => contentSet.has(token)).length;
  return matched / queryTokens.length;
}

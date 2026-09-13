import type { RetrievalCandidate } from "./knowledge-graph.js";

export type RetrievalBranch = "semantic" | "keyword" | "graph" | "temporal" | "entity";

export interface RetrievalBranchResult {
  readonly branch: RetrievalBranch;
  readonly candidates: readonly RetrievalCandidate[];
}

export interface RankedRetrievalResult extends RetrievalCandidate {
  readonly score: number;
}

const weights: Readonly<Record<RetrievalBranch, number>> = {
  semantic: 0.3,
  keyword: 0.25,
  graph: 0.2,
  temporal: 0.1,
  entity: 0.15,
};

export class RetrievalFusion {
  /**
   * Fuses per-branch results into one ranked list. `memory-ranking.md`
   * separates two kinds of factor: the five search methods' own scores
   * (fused with the branch weights below, since a candidate found by
   * several methods should score higher than one found by only one),
   * and a fixed set of *candidate-level* factors — importance,
   * confidence, recency, project relevance, usage frequency, explicit
   * pinning — that describe the record itself, not which method found
   * it. Those candidate-level factors are computed once per candidate,
   * not once per branch: a candidate surfaced by three branches gets
   * its branch score summed three times (that's the point — more
   * corroborating methods should count for more), but its importance/
   * confidence/pinning bonus must not also be tripled just because it
   * happened to be found three ways. (An earlier version of this
   * method added the full candidate-level bonus inside the per-branch
   * loop, so a candidate appearing in N branches got that bonus N
   * times — fixed here.)
   */
  fuse(branches: readonly RetrievalBranchResult[]): RankedRetrievalResult[] {
    const branchContribution = new Map<string, number>();
    const candidateById = new Map<string, RetrievalCandidate>();
    for (const branch of branches) {
      const branchWeight = weights[branch.branch];
      for (const candidate of branch.candidates) {
        if (candidate.inactive) {
          continue;
        }
        const branchScore = candidate[`${branch.branch}_score` as keyof RetrievalCandidate];
        const numericBranchScore = typeof branchScore === "number" ? branchScore : 0;
        const existing = branchContribution.get(candidate.id) ?? 0;
        branchContribution.set(candidate.id, existing + numericBranchScore * branchWeight);
        if (!candidateById.has(candidate.id)) candidateById.set(candidate.id, candidate);
      }
    }

    const results: RankedRetrievalResult[] = [];
    for (const [id, candidate] of candidateById) {
      const score = Math.min(1, (branchContribution.get(id) ?? 0) + this.candidateLevelBonus(candidate));
      results.push({ ...candidate, score });
    }
    return results.sort((left, right) => right.score - left.score);
  }

  private candidateLevelBonus(candidate: RetrievalCandidate): number {
    return (
      candidate.importance * 0.2 +
      candidate.confidence * 0.15 +
      candidate.recency * 0.1 +
      candidate.project_relevance * 0.1 +
      Math.min(1, candidate.usage_frequency) * 0.05 +
      (candidate.pinned ? 0.4 : 0)
    );
  }
}

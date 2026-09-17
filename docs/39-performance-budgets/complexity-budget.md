# Complexity Budget

## Purpose

Algorithmic complexity ceilings for the operations most exposed to
data-scale growth — a latency budget (`latency-targets.md`) states the
number that must hold; this file states the growth *shape* an
implementation must have to keep holding it as Memory and the Knowledge
Graph grow over months/years of use, per `docs/11-performance/
benchmarks.md`'s aged-dataset testing methodology.

## Scope

Complexity ceilings for the specific operations below only — not a
blanket algorithmic-complexity policy for every function in the
codebase, which would be an unenforceable, low-value rule at this
repository's level of abstraction.

## Budgets

| Operation | Ceiling | Why this matters at scale |
|---|---|---|
| Knowledge Graph edge traversal (single entity, direct relations) | O(degree of the node), never O(total graph size) | `docs/04-memory/indexes.md`'s `(from_node_id)`/`(to_node_id)` indexes exist specifically so this never becomes a full-table scan as the graph grows. |
| Retrieval Fusion Engine, single branch | O(log n) index lookup plus O(k) for the requested result count, where n is that branch's table size and k is the result limit | A branch that scans its full table per query would make `docs/29-product/search.md`'s "never degrade to a blank/error result" promise technically true but practically unusable once Long-term Memory reaches realistic scale. |
| Retrieval Fusion Engine, cross-branch merge/rank | O(k log k) for k = sum of per-branch results before truncation to the final result count | Merge-sort-shaped, not O(k²) pairwise comparison — `docs/04-memory/retrieval-engine.md`'s fusion step ranks a bounded candidate set, not the full corpus. |
| Circuit breaker state check (per call) | O(1) | A per-call check that scanned provider history would defeat the fail-fast purpose the breaker exists for (`docs/26-system-reference/19-ordering-concurrency-and-retry-rules.md`). |
| Vector index (ANN) query | Sub-linear in corpus size (index-structure-dependent; never a brute-force O(n) linear scan once the corpus exceeds the brute-force-viable threshold noted in `docs/04-memory/retrieval-engine.md`) | The whole reason an ANN index exists rather than a linear scan over `embeddings`. |

## What this file does not cover

One-time or admin-path operations (index rebuild, backup, migration) are
explicitly out of scope — those are allowed to be O(n) in total data
size because they run rarely and off the interactive-latency path,
governed instead by docs/13-devops/backup.md's and docs/38-disaster-
recovery/migration.md's own timing expectations, not this file's
per-query budgets.

## Related documents

- `docs/39-performance-budgets/latency-targets.md` — the absolute-time budgets these complexity ceilings exist to keep achievable as data grows
- `docs/04-memory/indexes.md` — the indexes these complexity ceilings assume exist
- `docs/04-memory/retrieval-engine.md` — the fusion pipeline these ceilings apply to
- `docs/11-performance/benchmarks.md` — the aged-dataset methodology that would catch a ceiling violation

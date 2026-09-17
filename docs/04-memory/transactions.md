# Transactions

## Purpose

Transaction boundaries for writes to `table-contracts.md`'s tables —
which multi-row writes must be atomic, and how that atomicity relates to
the unified-snapshot guarantee `docs/13-devops/backup.md` already
provides for backup/restore.

## Scope

Write-time transaction boundaries. Backup-time consistency (a different,
complementary guarantee) is `docs/13-devops/backup.md`. Migration-time
schema-change transactions are `docs/38-disaster-recovery/migration.md`.

## Required atomic transactions

| Operation | Tables involved | Why atomic |
|---|---|---|
| Knowledge Graph node merge | `graph_nodes`, `graph_edges` | `graph.node_merged` (`docs/26-system-reference/07-event-catalog.md`) reassigns every edge from the merged-away node to the surviving node — a partial commit would leave edges pointing at a node that no longer exists, silently breaking `relationships.md`'s foreign-key guarantee. |
| Memory promotion (Recent → Long-term) | `recent_memory_entries` (read), `long_term_memory_entries` (insert), lineage reference | Per `memory-lifecycle.md`, promotion happens only after verification passes; the new Long-term row and its lineage pointer back to the Recent row it was promoted from must land together, or a crash mid-promotion would produce a Long-term fact with no traceable source, violating `docs/04-memory/search.md`'s grounding requirement. |
| Task state transition + resulting memory write | `tasks`, `recent_memory_entries` or `long_term_memory_entries` | A task reaching `Completed` (`docs/26-system-reference/04-state-transition-tables.md`) and the memory write recording its outcome are one logical event — an agent querying "what did that task do" must never observe a `Completed` task with no recorded outcome. |
| Embedding insert with dimension check | `embeddings` | Single-row, but the dimension-match check (`FM-01-019`) and the insert itself must be one transaction — check-then-insert as two separate statements would allow a race where a concurrent schema/model change passes between them. |

## Isolation level

Read committed is the default isolation level for all transactions
above — NOVA does not require serializable isolation anywhere, since the
Resource Manager's lock model (`docs/03-runtime/resource-manager.md`)
already prevents the concurrent-write races serializable isolation would
otherwise be needed to catch; using the database's strongest isolation
level unconditionally would cost latency budget (`docs/39-performance-
budgets/latency-targets.md) the actual concurrency pattern doesn't
require.

## Relationship to backup consistency

A transaction commit and a backup snapshot are different consistency
mechanisms answering different questions: transactions guarantee no
other reader ever observes a half-written multi-table change; the
unified snapshot in `docs/13-devops/backup.md` guarantees a *restore*
point where every engine (structured store, vector index, graph tables)
reflects the same moment in time. Neither substitutes for the other —
a restore from a snapshot taken between two transactions is still fully
consistent precisely because each transaction already left the database
in a valid state at every point a snapshot could have been taken.

## Related documents

- `table-contracts.md` — the tables these transactions write to
- `docs/13-devops/backup.md` — the complementary snapshot-consistency guarantee
- `docs/03-runtime/resource-manager.md` — the lock model that makes read-committed isolation sufficient
- `docs/04-memory/memory-lifecycle.md` — the promotion process this file's atomicity requirement protects

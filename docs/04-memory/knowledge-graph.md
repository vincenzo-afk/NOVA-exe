# Knowledge Graph

## Purpose

Describes the structure and query patterns of NOVA's Knowledge Graph —
the fixed-schema store of entities and relationships that lets NOVA answer
questions about how things connect, not just what individual facts exist.

## Scope

Graph structure and query patterns. The fixed schema itself (node/edge
types and versioning rules) is `ontology.md`; how mentions resolve to the
correct existing node is `entity-resolution.md`.

## Why a graph *model*, and why fixed-schema

A relational store can represent "project X has file Y" as a join, but
representing arbitrary-depth relationship queries ("what decisions relate
to files that relate to project X") is awkward to express as hand-written
joins that grow one JOIN clause deeper per hop. NOVA adopts the **graph
data model** — nodes and edges — to make these queries natural to express
and reason about, but implements that model over relational tables
(`graph_nodes`, `graph_edges`; `docs/04-memory/table-contracts.md`,
`relationships.md`), not a separate graph-database product — this is the
locked decision in `docs/14-development/technology-stack.md`, made
specifically so the Knowledge Graph shares the same transactional and
backup story as the rest of persisted state
(`docs/13-devops/persistence.md`) rather than requiring a second database
engine to operate, back up, and keep consistent with the first. An
implementer building this component integrates the relational schema in
`table-contracts.md`, never a graph-database driver or query language —
"graph" here describes the data model and query patterns below, not the
storage engine. The schema is fixed (rather than allowed to grow ad hoc
under LLM control) because an earlier architectural review of this
project identified schema drift — an ever-growing, LLM-authored
ontology — as a direct path to long-term query inconsistency; see
`ontology.md` for the resulting versioning process.

## Core node types

v1: User, Project, File, Application, Task, Decision, Tool, Conversation.
v2 (additive): Person, Goal, Device. Each node type has a fixed set of
properties (e.g., a File node always has a path, a type, and timestamps;
a Decision node always has a statement, a date, and a linked rationale)
defined in `ontology.md`.

## Core edge types

v1: `belongs_to` (File → Project), `produced_by` (Decision → Task or
Conversation), `depends_on` (Project → Tool), `related_to` (generic,
weighted relationship for cases not covered by a more specific edge type),
`performed_on` (Task → File/Application). v2 (additive): `involves`
(Conversation/Task → Person), `pursues` (User → Goal), `advances` (Task →
Goal), `blocks` (any → Goal), `resides_on` (File → Device). The full,
closed list is in `ontology.md`.

## Query patterns

- **Direct entity lookup** — "what is project X" resolves to a single
  node and its properties.
- **One-hop traversal** — "what files belong to project X" resolves via
  the `belongs_to` edge.
- **Multi-hop traversal** — "what decisions relate to files I edited in
  project X this month" combines `belongs_to`, `performed_on`, and
  `produced_by` with a temporal filter, which is where the Knowledge
  Graph's advantage over a purely relational query becomes significant.
- **Relationship discovery** — "how are project X and project Y related"
  looks for a shared path between two nodes, surfacing connections the
  user may have forgotten existed.

## Write path

Nodes and edges are only created or updated through the indexing pipeline
(`indexing.md`) after entity resolution (`entity-resolution.md`) — there
is no direct write path from the Planner or any agent instance straight
into the graph, which keeps graph writes auditable and consistent with
the rest of the memory lifecycle.

## Consistency guarantee

A node is never created with a relationship to a non-existent node — edge
creation always validates both endpoints exist first, and orphaned-edge
cleanup runs as part of the memory lifecycle's background maintenance
(`memory-lifecycle.md`) when a referenced node is deleted (e.g., a File
node whose underlying file was permanently removed and its retention
window has passed).

## Node and edge update rules

- **Merging** — per `entity-resolution.md`'s manual and automatic merge
  paths; a merge is never silent for automatic (non-`high-confidence`)
  cases, per that document's confidence threshold.
- **Splitting** — the inverse of merging, always manually initiated
  (`entity-resolution.md`), never automatic — the system can propose a
  merge review queue but does not autonomously decide to split an
  existing, already-merged node.
- **Expiration / becoming inactive** — a node is marked **inactive**
  (not deleted) when every edge referencing it has expired or been
  deleted per `docs/04-memory/memory-lifecycle.md`'s expiration tiers,
  and no new activity has referenced it within a configurable window. An
  inactive node is excluded from default retrieval ranking
  (`docs/04-memory/memory-ranking.md`) but is not physically removed
  until it separately qualifies for garbage collection
  (`docs/04-memory/memory-garbage-collection.md`) — "inactive" and
  "deleted" are distinct states with different consumers (a user can
  still explicitly query inactive nodes; a deleted node is gone).
- **Confidence updates** — a node's confidence updates per
  `docs/04-memory/memory-confidence.md`'s general model; a node
  referenced by many high-confidence edges trends toward higher
  confidence than one referenced by a single low-confidence, unverified
  edge.
- **Edge weights** — every edge carries a weight reflecting relationship
  strength, distinct from the confidence of the fact the edge represents.
  A `related_to` edge's weight increases each time the same relationship
  is independently corroborated (e.g., the same two projects referenced
  together across multiple separate tasks) and is used by
  `docs/04-memory/retrieval-engine.md`'s graph-search component to rank
  closer, stronger relationships above weaker, incidentally-observed
  ones. Fixed-type edges (`belongs_to`, `produced_by`) do not carry a
  meaningful weight beyond 1.0, since their relationship is structural
  and binary (a File either belongs to a Project or it does not) rather
  than a matter of degree.

## Related documents

- `docs/25-failure-modes/FM-01-memory-and-knowledge-graph.md` — failure modes for this subsystem
- `ontology.md` — the fixed schema this graph implements
- `entity-resolution.md` — how mentions resolve to existing nodes
- `indexing.md` — the write path into this graph
- `retrieval-engine.md` — how graph queries participate in fusion
  retrieval
- `docs/04-memory/memory-garbage-collection.md` — physical reclamation
  once a node qualifies for deletion, distinct from becoming inactive
- `docs/04-memory/memory-confidence.md` — the confidence model node
  updates follow
- `docs/20-devices/spatial-perception.md` — camera-identified physical
  objects converge on the same nodes this graph already uses for
  text-mentioned entities

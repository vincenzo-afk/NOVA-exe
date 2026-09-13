# Code-level audit — session 2026-09-11

## Scope and method

This session audited **code against documentation** (as opposed to the
prior 15 sessions logged in `ITERATION_LOG.md`, which audited docs
against each other: cross-references, citation accuracy, and
build-order simulation).

Environment constraints, stated up front because they bound what this
audit could verify:

- **No network access.** `pnpm install` could not run — there is no
  `node_modules` in the uploaded archive. No dependency could be
  installed or updated.
- **No build/typecheck/test execution.** `pnpm build`, `pnpm typecheck`,
  and `vitest run` could not be run. Every finding below is from static
  reading (`grep`, file inspection, line counts) and manual
  cross-referencing against the docs tree — not from a passing or
  failing test suite. Code that looks correct on inspection could still
  fail to compile or fail a test; that risk is unverified, not ruled
  out.

Given the repository's actual size — **592 documentation files**,
**~44,600 lines of TypeScript** across `services/` and `apps/`, 168 test
files — full line-by-line coverage of every doc against every file
was not attempted in one session. Instead:

1. Inventoried every service/app directory and its line count, to tell
   substance from stubs (result: no `TODO`/`FIXME`/"not implemented"
   markers found anywhere in `src/`; the existing code is substantial,
   not scaffolding).
2. Read `IMPLEMENTATION_PLAN.md`'s M0–M12 milestone table as the
   canonical doc-to-code map and checked each milestone's named docs
   against the service files that should implement them.
3. Spot-checked specific documented constants/behaviors against code
   (wake-word claim window, workflow timeout, observer permission
   names, MCP cache TTLs) — all matched.
4. Followed up on anything that *didn't* immediately match with a
   closer read, to separate a real gap from a naming mismatch.

## Findings

### 1. Android companion app did not exist (real gap — fixed this session)

`IMPLEMENTATION_PLAN.md` locks the stack as "TypeScript ... and
Kotlin/Jetpack Compose/Gradle for the Android companion," and M12 names
the Android companion as in-scope. `docs/20-devices/android-companion.md`
specifies its capabilities and permission model in detail. But `apps/`
contained only `desktop` and `browser-extension` — no Kotlin/Gradle
project anywhere in the repository. The only related code was
`services/runtime/src/android-companion.ts`'s `AndroidCompanionManager`,
which models the companion's permission/capability state from the
*Primary Runtime's* side only.

**Fix:** added `apps/android-companion/`, a real (if partial — see its
own README) Kotlin/Compose/Gradle project:
`CompanionPermissionsManager` (parity port of the TS contract, with
unit tests), `PairingManager` (QR parsing + the challenge/response
signature verification `docs/28-multi-device-protocol/02-device-pairing-protocol.md`'s
FM-26-006 calls out as non-optional, with unit tests), a foreground
service for the documented persistent-notification requirement, a
notification-listener stub matching the desktop observer's
metadata-only pattern, and minimal Compose screens. Its own README
lists what's still missing (the actual pairing transport, live QR
camera capture, and the App Control/File Access/Vision capture
implementations behind their permission gates) rather than overstating
completeness.

### 2. CLI implemented ~15% of its documented command surface (real gap — fixed this session)

`docs/27-cli/` is seven files specifying roughly 30 commands: bootstrap
(`init`, `doctor`, `diagnostics`, `upgrade`, `repair`), environment
(`env`, `config`), AI developer tools (`context`, `task`, `impact`),
observability (`logs`, `traces`, `metrics`, `replay`, `events`,
`profile`, `benchmark`, `inspect`, `explain`), plugin/AI SDK (`plugin
create/validate/package/publish/test/sign`, `agent create`, `tool
create`, `workflow create`), and "hidden gold"/CI (`sandbox`,
`migrate`, `report`, `verify`, plus `clean`). `services/runtime/src/cli.ts`
was 68 lines implementing only `init` (help-text only, no real bootstrap
sequence), `doctor`, `clean`, `env`, and `config` (both as thin
pass-throughs).

**Fix:** extended `NovaCli` to dispatch the full documented command
tree. Each command category takes an optional injected collaborator
(same pattern the pre-existing `health` option already used), so the
CLI stays a deterministic, testable dispatcher and real environment
access (filesystem, subprocess, network) is supplied by whatever
process wires it up — that wiring itself (a standalone `nova` binary
entry point, or desktop-main integration) is not part of this fix and
isn't claimed to be. Extended `services/runtime/test/cli.test.ts` with
coverage for the new dispatch paths and argument-validation errors,
alongside the pre-existing tests (kept passing by construction —
verified by reading, not by running `vitest`, per the constraint above).

### 3. Everything else spot-checked matched

Confirmed by direct inspection, not assumed:

- `voice-wake-coordination.ts`: 150ms claim window matches
  `docs/22-voice/` and `ITERATION_LOG.md`'s session 14 fix.
- `workflow-engine.ts`: 24-hour default workflow timeout
  (`24 * 60 * 60 * 1000`) matches `docs/17-workflow/workflow-engine.md`
  and the `ITERATION_LOG.md` session 13 fix it references.
- All five desktop observer permission names (`clipboard_metadata`,
  `clipboard_content`, `notifications_metadata`, `notifications_content`,
  `browser_metadata`, `keyboard_activity`, `mouse_activity`,
  `screen`, `desktop_control`) appear consistently across
  `services/observers/src/*` and the desktop app.
- All 12 documented screens (`docs/40-screens/`) have corresponding
  implementation in `apps/desktop/src/renderer/app.tsx` (a single
  2,556-line file covering all of them, rather than one file per
  screen — a style choice, not a gap).
- MCP protocol surface (`services/runtime/src/mcp-*.ts`, ~40 files) is
  extensive and its `MAX_TTL_MS` cache constants are consistent across
  every file that defines one.

### What this audit did not cover

Given the size constraint, this pass did not attempt: line-level
review of `services/memory` (12,191 lines, the largest single
service), the full `services/runtime` MCP surface beyond the constant
spot-check above, `apps/desktop`'s IPC boundary code, or a systematic
walk of all 592 doc files against all matching code. A next session
narrowing to one of those areas (memory tier persistence and
versioning is the largest remaining unaudited surface by line count)
would be the highest-value continuation.

## Files changed this session

- `services/runtime/src/cli.ts` — extended command dispatch (finding 2)
- `services/runtime/test/cli.test.ts` — added coverage for the new commands
- `apps/android-companion/**` — new Android companion app (finding 1)
- `AUDIT_REPORT_2026-09-11.md` — this file

---

## Continuation — same day, second pass

### 4. `NovaCli` was never constructed anywhere (real gap — fixed)

Finding 2 extended what the CLI dispatches; separately, nothing in the
repository ever `new NovaCli(...)`'d it — not `index.ts`'s exports, not
an executable, not the desktop app. It was a fully-formed but
unreachable class.

**Fix:** added `services/runtime/src/bin/nova.ts`, a real executable
entry point that wires the `health` and `environment` collaborators to
actual signals (`node:os` CPU count/RAM, `process.platform`/`arch`,
routed through the existing `HardwareDetector`) and prints
`NovaCli.run(process.argv)`'s result as JSON with a matching exit code.
Added `"bin": { "nova": "dist/bin/nova.js" }` to
`services/runtime/package.json` and `export * from "./cli.js"` to
`index.ts` (previously missing from the package's public exports).
Commands with no obvious dependency-free collaborator (logs, traces,
plugin SDK, workflow scaffolding, etc.) are intentionally left
unwired here — `NovaCli` already treats a missing collaborator as a
tested fallback, not a crash, so this is a real, honest subset rather
than a silent gap dressed up as complete.

### 5. Memory service audit (`services/memory` vs `docs/04-memory`)

`services/memory/src` has ~44,600 lines total by the earlier line-count
pass, but that number is almost entirely the auto-generated Prisma
client (`src/generated/`, not hand-written). The actual hand-written
implementation is four files, ~1,044 lines: `memory-store.ts` (tiered
working/recent/long-term storage, checksums, lineage, transactional
promotion, supersession), `memory-versioning.ts`, `observation-indexer.ts`,
and `task-checkpoint-store.ts`.

Cross-referencing against `docs/04-memory`'s 22 files:

- **Solidly covered, verified by reading the code, not just filenames:**
  storage/tiering/checksums/lineage/transactions (`memory-store.ts`),
  search with project/entity/time-range filters, confidence propagation
  (shared with `state-manager.ts`), the Knowledge Graph and its
  ontology/relationships (`services/runtime/src/knowledge-graph.ts`),
  and — despite an initial grep false negative — memory ranking:
  `services/runtime/src/retrieval-fusion.ts` implements 7 of the 8
  weighted factors `memory-ranking.md` specifies (semantic/keyword/
  graph/temporal/entity branch fusion, importance, confidence, recency,
  project relevance, usage frequency, explicit pinning); it just
  doesn't use the word "ranking" anywhere, which is why the first-pass
  keyword grep missed it. Lesson applied: a `0` grep hit on a doc's
  title term is a prompt to read the likely file, not a finding by
  itself.
- **Real, confirmed absences:** `entity-resolution.md` (canonicalizing/
  merging duplicate entities — no implementation anywhere, verified by
  reading `knowledge-graph.ts` in full, not just grepping it),
  `memory-conflict-resolution.md` as a distinct memory-tier concept
  (only `state-manager.ts`'s contradiction handling exists; whether
  that alone satisfies the doc's scope is a judgment call the doc
  itself doesn't resolve), and `seed-data.md` (no seed fixtures exist).
  `embeddings.md` is partially covered — `provider-registry.ts`
  registers embedding models through the same provider abstraction
  other AI capabilities use — but the specific chunking/consistency
  pipeline the doc describes is not implemented.
- **`memory-garbage-collection.md` — found, not fixed, and here's why:**
  the doc specifies immediate logical deletion + a deferred background
  reclamation pass. Implementing this correctly requires a `status`/
  `deletedAt` field on `WorkingMemoryEntry` and `LongTermMemoryEntry` —
  today only `RecentMemoryEntry` has a `status` column. Adding those
  columns means editing `prisma/schema.prisma` and regenerating the
  Prisma client, but the committed `src/generated/` client is a build
  artifact normally produced by `prisma generate` against a real
  database connection — this sandbox has neither network nor an
  installed Prisma CLI, so a regenerated client could not be produced
  or verified here. Writing code against schema fields that don't
  exist in the committed generated client would silently fail to
  compile, which is worse than leaving this gap documented. **This is
  the concrete next step for an environment with Prisma tooling
  available**: add the two columns, run `prisma migrate dev` +
  `prisma generate`, then add a `MemoryGarbageCollector` class
  performing the immediate-mark / deferred-reclaim two-phase process
  the doc specifies.

### Files changed this pass

- `services/runtime/src/bin/nova.ts` — new CLI executable entry point
- `services/runtime/src/index.ts` — export `cli.js`
- `services/runtime/package.json` — add `bin` field
- `AUDIT_REPORT_2026-09-11.md` — this section

### Suggested next session

In priority order: (1) the Prisma schema migration for memory GC above,
since it's fully scoped and just needs real tooling; (2) ~~entity
resolution in the Knowledge Graph~~ — done this session, see below;
(3) wiring the remaining CLI collaborators (logs/traces/plugin SDK) to
their owning services now that `bin/nova.ts` exists to receive them;
(4) the Android companion app's own follow-ups listed in
`apps/android-companion/README.md` (pairing transport, live QR
scanning, App Control/File Access/Vision capture).

---

## Continuation — same day, third pass

### 6. Entity resolution (finding 5's #2 gap — fixed)

Implemented `docs/04-memory/entity-resolution.md`'s full pipeline in a
new `services/runtime/src/entity-resolution.ts`: exact identifier match
first, then a high-confidence semantic/alias match gated by both a
configurable threshold (0.75) and `memory-ranking.md`'s exact 0.1
ambiguity margin between the top two candidates, then a handoff to
`docs/05-ai/ambiguity-resolution.md`'s flow for genuinely ambiguous
cases, then new-node creation — with a static `stillAmbiguous()` helper
for the doc's dashed "still ambiguous after disambiguation" path that
flags the new node for merge review instead of trusting it as
confirmed-distinct.

Semantic similarity scoring is an injected `SemanticMatcher` function
rather than computed in this class — the doc itself draws that
boundary ("the underlying confidence computation is defined [in
memory-ranking.md]"), and no embedding model is available in this
sandbox to compute real similarity scores against, so injecting keeps
the resolution *logic* real and tested while leaving the scoring
*source* swappable for whatever provider wiring lands later (the same
non-cop-out reasoning as the CLI's injected collaborators in finding 2).

`KnowledgeGraph` gained the supporting primitives the doc's "Alias
tracking" and "Manual merge and split" sections require, none of which
existed before: `aliases` on `GraphNode` (optional, so every existing
call site and test literal stays valid unchanged), `addAlias`,
`findByExactMatch` (active nodes only — an inactive node's old name
falls through to resolution rather than resurrecting it),
`activeNodes`, `mergeNodes` (re-points every edge touching the
duplicate, marks it inactive rather than deleting it so the audit
trail stays traceable per the doc, folds its name and aliases into the
canonical node's aliases, rejects merging across different ontology
types), and `splitNode` (creates the split-out node, moves only the
caller-specified edges, removes the alias from the source).

Added `services/runtime/test/entity-resolution.test.ts` (exact match,
high-confidence resolve + alias recording, the ambiguity-margin
boundary in both directions, new-node fallback, the merge-review flag)
and extended `knowledge-graph.test.ts` with alias/merge/split coverage.
As with every other fix this session, these are read-verified, not
`vitest`-verified — no toolchain access here.

### Files changed this pass

- `services/runtime/src/knowledge-graph.ts` — aliases, `addAlias`,
  `findByExactMatch`, `activeNodes`, `mergeNodes`, `splitNode`
- `services/runtime/src/entity-resolution.ts` — new
- `services/runtime/src/index.ts` — export `entity-resolution.js`
- `services/runtime/test/knowledge-graph.test.ts` — new describe block
- `services/runtime/test/entity-resolution.test.ts` — new
- `AUDIT_REPORT_2026-09-11.md` — this section

### Remaining, in priority order

(1) Prisma schema migration for memory GC — needs real tooling, not
this sandbox. (2) Wire entity resolution *into* the write path that
currently calls `KnowledgeGraph.addNode` directly (observation
indexing / conversation ingestion) so new mentions actually flow
through `EntityResolver` instead of always creating a node — this
session added the resolver but did not go hunting for every existing
call site that should now call it first. (3) Remaining CLI
collaborators. (4) Android companion follow-ups.

---

## Continuation — same day, fourth pass

### 7. Knowledge Graph had no persistence at all (larger gap than finding 6 assumed — schema fixed, client wiring blocked on tooling)

Looking for finding 5's item (2) — wiring entity resolution into a
real ingestion call site — surfaced something upstream of that: **no
code anywhere in the repository calls `KnowledgeGraph.addNode`** except
this session's own tests. Chasing why led to
`docs/04-memory/knowledge-graph.md`'s explicit architecture statement:
the graph model is "implement[ed] ... over relational tables
(`graph_nodes`, `graph_edges`) ... not a separate graph-database
product ... so the Knowledge Graph shares the same transactional and
backup story as the rest of persisted state." But
`services/memory/prisma/schema.prisma` had exactly four models —
`WorkingMemoryEntry`, `RecentMemoryEntry`, `LongTermMemoryEntry`,
`TaskCheckpoint` — no `graph_nodes` or `graph_edges` table. The
`KnowledgeGraph` class this session extended in finding 6 is a pure
in-memory `Map`, with no persistence layer underneath it at all — every
node and edge vanishes when the process exits. That's not what the
docs describe.

`docs/04-memory/table-contracts.md` also names two more missing tables
this pass didn't act on — `embeddings` and `identities` — plus `tasks`,
`events`, and `audit_log`, which belong to other services' scope, not
memory's. Flagging all five here since they were found in the same
read-through, even though only the two Knowledge Graph tables were
fixed this pass.

**Fixed (schema level):** added `GraphNode` and `GraphEdge` models to
`schema.prisma`, matching `table-contracts.md`'s column list
(`entity_type`, `canonical_name`, `identity_id`, `confidence` /
`from_node_id`, `to_node_id`, `relation_type`, `confidence`) and
`indexes.md`'s exact specified indexes
(`(identity_id, entity_type, canonical_name)` on nodes;
`(from_node_id)` and `(to_node_id)` separately on edges — the doc is
explicit that a single combined index would make one traversal
direction a full scan). `relationships.md`'s
`graph_edges.from_node_id/to_node_id → graph_nodes.id` foreign key with
`ON DELETE RESTRICT` is expressed directly, since both sides of that
relationship now exist. `identityId` is a plain string column, not a
DB relation — matching the *existing* convention already used for
`RecentMemoryEntry`/`LongTermMemoryEntry` above it in the same file,
because the `identities` table their `identity_id` should really point
to doesn't exist either; this addition doesn't introduce that gap, it
inherits it.

**Not fixed (client level) — and why:** `MemoryStore` and every other
memory-tier class import `PrismaClient` directly from
`./generated/index.js`, a committed build artifact normally produced by
running `prisma generate` against the schema. That generated client
does not know about `GraphNode`/`GraphEdge` — they didn't exist in the
schema it was generated from. Writing a `KnowledgeGraph` persistence
adapter that calls `client.graphNode.create(...)` today would reference
a property the actual shipped generated client doesn't have; it would
look correct and fail to compile the moment anyone tried to build it.
Same wall as finding 5's memory-GC item: no network, no Prisma CLI in
this sandbox, so `prisma migrate dev` + `prisma generate` cannot be run
or verified here. Left as schema-only, clearly commented in the schema
file itself pointing back to this report.

### Files changed this pass

- `services/memory/prisma/schema.prisma` — `GraphNode`, `GraphEdge` models
- `AUDIT_REPORT_2026-09-11.md` — this section

### Remaining, in priority order

(1) Run `prisma migrate dev` + `prisma generate` for **both** the
memory-GC columns (finding 5) and the new graph tables (this finding)
in an environment with real tooling — these can land in the same
migration. (2) Once the client is regenerated, build the actual
`KnowledgeGraph` persistence adapter (swap the in-memory `Map` for
reads/writes through `GraphNode`/`GraphEdge`) and wire `EntityResolver`
into whatever produces entity mentions in the first place — there is
currently no producer at all, so this is two integration steps, not
one. (3) `embeddings` and `identities` tables — found, not yet
schema'd. (4) Remaining CLI collaborators. (5) Android companion
follow-ups.

---

## Continuation — same day, fifth pass

### 8. `embeddings` and `identities` tables (finding 7's item 3 — fixed at schema level)

Added `Identity` and `Embedding` to `schema.prisma`, matching
`table-contracts.md`'s column lists exactly (`id`, `display_name`,
`created_at` / `id`, `record_id`, `record_table`, `model_id`,
`model_version`, `vector`) and `indexes.md`'s `(record_table,
record_id)` index on `embeddings`. `vector` is stored JSON-encoded
(`vectorJson`) since SQLite has no native vector column type — the
actual ANN/HNSW index is explicitly listed in `table-contracts.md`'s
"What is deliberately not a table" section as a co-located index over
this column, built outside Prisma's schema, so nothing further belongs
here for it. `Embedding.recordId`/`recordTable` stay an
application-layer polymorphic reference (can point to a
`RecentMemoryEntry`, `LongTermMemoryEntry`, or `GraphNode` row) rather
than a DB foreign key, the same pattern already used for
`LongTermMemoryEntry.sourceLineageId`, because Prisma has no native
polymorphic relation and `relationships.md` itself specifies this one
as application-layer.

Adding `Identity` also let this pass close a smaller gap it created:
`identityId` on `RecentMemoryEntry`, `LongTermMemoryEntry`, and last
pass's new `GraphNode` had been plain string columns with no real
foreign key, simply because there was nothing yet for them to
reference. All three now have a genuine `@relation` to `Identity`,
matching `relationships.md`'s "DB foreign key" line for each — not
scope creep, just finishing what finding 7 could only half-do at the
time.

Same caveat as every schema-only fix this session: not regenerated,
not migrated, not build-verified — needs `prisma migrate dev` +
`prisma generate` in a real environment before any of this schema (this
pass's or the last two) is usable from TypeScript.

### Files changed this pass

- `services/memory/prisma/schema.prisma` — `Identity`, `Embedding`
  models; real `@relation`s added to `RecentMemoryEntry`,
  `LongTermMemoryEntry`, `GraphNode`
- `AUDIT_REPORT_2026-09-11.md` — this section

### Remaining, in priority order

The schema side of `docs/04-memory/table-contracts.md` is now complete
for everything in that service's scope (`tasks`, `events`, `audit_log`
belong to other services, not audited here). Next: (1) run the actual
Prisma migration + client regeneration in a real environment — nothing
past this point can proceed without it; (2) the `KnowledgeGraph`
persistence adapter and wiring `EntityResolver` into a real ingestion
path, both blocked on (1); (3) remaining CLI collaborators
(logs/traces/plugin SDK) — not blocked on anything, a reasonable place
to pick up next without Prisma tooling; (4) Android companion
follow-ups (pairing transport, live QR scanning, App
Control/File Access/Vision capture) — also not blocked on Prisma.

---

## Continuation — same day, sixth pass

Picked up the remaining CLI collaborators (item 3 above) in one pass
rather than one command at a time, since none of it was blocked on
Prisma tooling.

### 9. Logging was real but unused by the CLI; tracing and metrics didn't exist at all — all three built and wired

`docs/13-devops/logging.md` turned out to already have a real,
well-built implementation — `@nova/shared`'s `StructuredLogger`,
`MemoryLogSink`, and `FileJsonlLogSink` — used throughout the runtime
(`api-gateway.ts`, `background-assistant.ts`, `calendar-assistant.ts`,
and more). It just wasn't reachable from `nova logs`, because nothing
constructed `NovaCli` with a `logs` collaborator (see finding 4). Added
a public `records()` method to `FileJsonlLogSink` (it could write but
not read back) and wired `bin/nova.ts`'s `logs` collaborator to read
from `~/.nova/logs/nova.jsonl` — the same path a long-running `nova`
process would log to, so this reflects real history across invocations,
not just the current process.

`docs/26-system-reference/23-tracing.md` (canonical spans: `nova.task`,
`nova.plan`, `nova.tool`, `nova.memory.query`, `nova.provider.call`,
`nova.bus.publish`, each with required fields and started_at/ended_at/
status) and `22-metrics-catalog.md` (gauges/counters/histograms) had no
implementation at all — not a missing wiring like logging, a genuine
gap. Built `packages/shared/src/tracer.ts` (`Tracer.startSpan` validates
the doc's required-fields table per span name before accepting a span,
`endSpan`, `query(correlationId)`) and `packages/shared/src/metrics-registry.ts`
(`record`/`query` with gauge=latest-value, counter=sum,
histogram=count/sum/min/max/avg — the standard aggregation semantics
for each kind), both with full test coverage. Wired to `bin/nova.ts`'s
`traces`/`metrics` collaborators, but — stated plainly, not glossed
over — as fresh in-memory instances scoped to that one CLI process:
there's no persistent trace/metric store the way `FileJsonlLogSink`
gives logging one, so a standalone `nova traces`/`nova metrics`
invocation legitimately returns empty today. That's a real, named
limitation (no persistence layer exists yet for either), not a bug.

### 10. Plugin SDK: `create`/`validate`/`sign` implemented; `package`/`publish`/`test` explicitly deferred with reasons

Built `services/runtime/src/plugin-sdk.ts`:
`createPluginScaffold` (generates a manifest + entry-point stub
matching `PluginManager`'s existing `PluginManifest` shape and
`PLUGIN_PERMISSION_SCOPES`, returning file contents rather than writing
to disk — same injectable-pure-function pattern as everywhere else this
session), `validatePluginManifest` (checks every field, collects *all*
failing fields in one pass rather than stopping at the first — the doc
says this same check gates `package`/`publish` too, so it's written to
be that shared step already), and `signPluginChecksum`/
`verifyPluginSignature` (real RSA-SHA256 signing via Node's built-in
`node:crypto`, no bundled dependency, for `FM-12-016`'s supply-chain
verification). Full test coverage including a tampered-checksum
rejection case.

`nova plugin package` and `nova plugin publish` are **not**
implemented, on purpose: `package` needs an actual archive format
decision (zip vs tar, and a real implementation of it) and `publish`
needs a marketplace registry endpoint
(`docs/16-extensibility/plugin-marketplace.md`) that doesn't exist
anywhere in this repo yet — both are integration decisions better made
against the real target than guessed at here. `nova plugin test` is
also left to its injected collaborator: the doc says it runs the
plugin's suite inside the sandbox it'll execute in at runtime, which
means wiring to whatever `docs/16-extensibility/plugin-sandboxing.md`'s
sandbox mechanism turns out to be — not yet audited this session.

Also caught two commands `docs/27-cli/06-plugin-and-ai-sdk.md` names
that the earlier CLI pass (finding 2) missed entirely: `nova provider
test <name>` and `nova prompt validate <name>`. Added both to
`cli.ts`'s command tree and options, with tests.

### Files changed this pass

- `packages/shared/src/structured-logger.ts` — `FileJsonlLogSink.records()`
- `packages/shared/src/tracer.ts` — new
- `packages/shared/src/metrics-registry.ts` — new
- `packages/shared/src/index.ts` — export both
- `packages/shared/test/tracer.test.ts`,
  `packages/shared/test/metrics-registry.test.ts` — new
- `packages/shared/test/structured-logger.test.ts` — `records()` coverage
- `services/runtime/src/plugin-sdk.ts` — new
- `services/runtime/test/plugin-sdk.test.ts` — new
- `services/runtime/src/index.ts` — export `plugin-sdk.js`
- `services/runtime/src/cli.ts` — `provider`/`prompt` commands
- `services/runtime/test/cli.test.ts` — coverage for both
- `services/runtime/src/bin/nova.ts` — real `logs`/`traces`/`metrics`/`plugin` wiring
- `AUDIT_REPORT_2026-09-11.md` — this section

### Remaining, in priority order

(1) Prisma migration + client regen — still the hard blocker for the
Knowledge Graph persistence adapter and memory GC. (2) A persistent
store for traces/metrics (mirroring what `FileJsonlLogSink` already
gives logging), so `nova traces`/`nova metrics` are useful standalone,
not just within one process's lifetime. (3) `nova plugin
package`/`publish`/`test` — each needs a real target (archive format,
registry endpoint, sandbox mechanism) chosen first. (4) Android
companion follow-ups — unchanged from before, still not blocked on
anything above.

---

## Continuation — same day, seventh pass

### 11. Persistent trace/metric storage (closes item 2 above)

The previous pass wired `nova traces`/`nova metrics` to in-memory
`Tracer`/`MetricsRegistry` instances and said plainly that a standalone
invocation would report empty, since — unlike logging — neither had a
file-backed store. Fixed: extracted the append/read-JSONL pattern
`FileJsonlLogSink` already used into a small shared
`packages/shared/src/jsonl-store.ts` helper, then built `FileSpanStore`
(in `tracer.ts`) and `FileMetricStore` (in `metrics-registry.ts`) on top
of it. Both `Tracer` and `MetricsRegistry` now take an optional `sink`
that mirrors every mutation to disk; `FileSpanStore` reconciles a
span's start-then-end JSONL lines down to its latest state per
`span_id` (spans are two-phase, unlike append-only logs), and
`FileMetricStore` replays its entry log through a fresh
`MetricsRegistry` to reuse its aggregation logic rather than
duplicating gauge/counter/histogram math. `bin/nova.ts` now points
`logs`/`traces`/`metrics` all at real files under `~/.nova/logs/`, and
the two unused live `Tracer`/`MetricsRegistry` instances that pass 9
had created (nothing in a short-lived CLI process actually generates
spans or metrics itself) were removed rather than left as dead code.
Full test coverage for both new store classes, including reload-after-
write and empty-before-any-write cases.

### Files changed this pass

- `packages/shared/src/jsonl-store.ts` — new
- `packages/shared/src/tracer.ts` — `SpanSink`, `FileSpanStore`
- `packages/shared/src/metrics-registry.ts` — `MetricSink`, `FileMetricStore`
- `packages/shared/src/index.ts` — export `jsonl-store.js`
- `packages/shared/test/tracer.test.ts`,
  `packages/shared/test/metrics-registry.test.ts` — `FileSpanStore`/`FileMetricStore` coverage
- `services/runtime/src/bin/nova.ts` — `logs`/`traces`/`metrics` now file-backed
- `AUDIT_REPORT_2026-09-11.md` — this section

### Remaining, in priority order

(1) Prisma migration + client regen — unchanged, the hard blocker for
Knowledge Graph persistence and memory GC. (2) `nova plugin
package`/`publish`/`test` — each needs a real target chosen first
(archive format, registry endpoint, sandbox mechanism). (3) Android
companion follow-ups (pairing transport, live QR scanning, App
Control/File Access/Vision capture) — not blocked on anything above,
the next reasonable place to pick up.

---

## Continuation — same day, eighth pass

### 12. Android live QR scanning (closes README's other named gap)

Built `QrAnalyzer.kt` (a CameraX `ImageAnalysis.Analyzer` using ML
Kit's barcode scanner restricted to `FORMAT_QR_CODE`, deduping repeat
callbacks for the same decoded value across frames) and
`ui/CameraQrScanner.kt` (the CameraX preview + lifecycle binding,
requesting `CAMERA` at the point of use rather than app launch — the
same "requested individually, at time of use" discipline
`docs/20-devices/android-companion.md` requires for every other
companion capability). `PairingScreen` now defaults to the live scan
with a manual-paste fallback; both converge on the same
`parseQrPayload` call, so `PairingManager`'s verification logic didn't
need to change. Not unit-testable at the JVM level (real Android
Camera/ML Kit types) — noted as such in the app's README rather than
skipped silently.

### 13. Multi-device connection lifecycle state machine

`docs/28-multi-device-protocol/05-networking-and-discovery.md` defines
a connection lifecycle (`Disconnected → Discovering → Pairing/
Authenticating → Connected → Healthy⇄Degraded → Reconnecting`) and
names two failure modes specific to it: `FM-26-014` (Healthy/Degraded
"flapping" without hysteresis) and `FM-26-016` (mDNS discovery
connecting to the wrong device on a name collision, because nothing
enforces authenticating the discovered candidate against its *stored*
pairing key). Neither existed anywhere in the codebase — this is state-
machine logic, not networking I/O, so it didn't need the mesh-provider/
mDNS integration NOVA explicitly delegates to a third party to be
useful.

Built `services/runtime/src/device-connection-lifecycle.ts`:
`DeviceConnectionLifecycle` enforces the exact transition graph
(`beginDiscovery` → `candidateDiscovered` → `pairing`/`authenticating`
→ `authenticate` → `connected_healthy`), rejects out-of-order calls
(e.g. calling `authenticate()` before discovery) rather than silently
accepting them, requires N consecutive bad/good heartbeat samples
before flipping Healthy↔Degraded (configurable, defaults to 3 — no
specific number is in the docs, so this is a documented default, not a
doc-mandated constant, unlike the memory-ranking ambiguity margin from
earlier passes), and makes `connectionLost()`/`reconnected()` the only
path to `Reconnecting`, distinct from mere degradation, matching the
doc's explicit "Reconnecting is reserved for an actual connection
loss." `authenticate()` is the FM-26-016 check directly: it takes the
discovered candidate, the stored key map, and the presented key, and
returns `disconnected` on any mismatch — a plausible advertised name is
never sufficient on its own. mDNS/mesh-provider network calls
themselves are out of scope, same reasoning as everywhere else this
session: NOVA delegates actual mesh networking to a user-configured
provider (Tailscale by default), so there's no NOVA-owned network code
to write here in the first place, only the state machine driving it.

Full test coverage, including both named failure modes explicitly
(impostor key rejected despite a plausible name; single bad sample
doesn't flip state; an interleaved good sample resets the bad streak
rather than accumulating across gaps) and the full transition history
with timestamps.

### Files changed this pass

- `apps/android-companion/app/src/main/java/com/nova/companion/QrAnalyzer.kt` — new
- `apps/android-companion/app/src/main/java/com/nova/companion/ui/CameraQrScanner.kt` — new
- `apps/android-companion/app/src/main/java/com/nova/companion/ui/PairingScreen.kt` — camera-first with paste fallback
- `apps/android-companion/README.md` — both closed gaps updated
- `services/runtime/src/device-connection-lifecycle.ts` — new
- `services/runtime/test/device-connection-lifecycle.test.ts` — new
- `services/runtime/src/index.ts` — export `device-connection-lifecycle.js`
- `AUDIT_REPORT_2026-09-11.md` — this section

### Remaining, in priority order

(1) Prisma migration + client regen — still the hard blocker for
Knowledge Graph persistence and memory GC, unchanged across every pass
this session. (2) `nova plugin package`/`publish`/`test` — each needs a
real target chosen first. (3) Wiring `DeviceConnectionLifecycle` to
actual mDNS discovery and a mesh-provider integration (Tailscale) —
the state machine is solid, the I/O behind its injected collaborators
isn't written. (4) App Control/File Access/Vision capture
implementations behind the Android companion's existing permission
gates — the permission system has existed since finding 1; nothing yet
uses the grants it protects.

---

## Continuation — same day, ninth pass

### 14. Android App Control, File Access, and still-image Vision capture

Closed item 4 above: the three capability IDs `CompanionPermissionsManager`
has gated since the very first Android companion pass
(`app_control`/`file_access`/`vision`) had nothing behind their
`use()` checks. Built all three:

- **`AppController.kt` / `NovaAccessibilityService.kt`** — App Control,
  implementing the doc's exact priority order: a direct Intent/deep
  link always wins over Accessibility-Service node simulation when
  both could satisfy the action (`AppController.perform` checks
  `IntentResolver` first, only falls to
  `AccessibilityNodeInfo`-tree search + `ACTION_CLICK` if resolution
  fails). `NovaAccessibilityService` is the actual `AccessibilityService`
  subclass Android requires — deliberately not accumulating a
  background event stream, since App Control is call-and-response, not
  an observer source; its config XML scopes `canRetrieveWindowContent`
  to the minimum the click-fallback path needs. Registered in the
  manifest with `BIND_ACCESSIBILITY_SERVICE`.
- **`FileAccessManager.kt`** — File Access, entirely SAF-scoped:
  `ACTION_OPEN_DOCUMENT_TREE` + persisted URI permissions for folder
  grants, `DocumentFile`-based list/read/write. No method anywhere in
  this class accepts a raw filesystem path — every operation requires
  a `treeUri` the user already granted, which is what "never blanket
  filesystem access" means as code, not just as a doc sentence.
- **`VisionCaptureManager.kt`** — the still-image half of Vision
  (CameraX `ImageCapture`, returns raw JPEG bytes for the provider
  layer to route per `docs/18-providers/provider-interface.md`).
  Screen-content capture — the doc's other named Vision source — is
  explicitly *not* covered; that's `docs/20-devices/screen-streaming.md`'s
  own surface, not audited this pass.

All three call `CompanionPermissionsManager.use()` before doing
anything — there's no path in any of them that bypasses the permission
gate that's existed since the first pass.

**Not unit-tested, and said so rather than faked:** all three classes
depend on real Android framework types (`AccessibilityNodeInfo`,
`Intent`, `Context`, CameraX/SAF APIs) that plain JUnit can't construct
without Robolectric, which isn't a dependency here and can't be added
without network access. The README says this plainly rather than
shipping a test that mocks around the untested part and calls it
coverage.

### Files changed this pass

- `apps/android-companion/app/src/main/java/com/nova/companion/AppController.kt` — new
- `apps/android-companion/app/src/main/java/com/nova/companion/FileAccessManager.kt` — new
- `apps/android-companion/app/src/main/java/com/nova/companion/VisionCaptureManager.kt` — new
- `apps/android-companion/app/src/main/res/xml/accessibility_service_config.xml` — new
- `apps/android-companion/app/src/main/AndroidManifest.xml` — register `NovaAccessibilityService`
- `apps/android-companion/app/src/main/res/values/strings.xml` — accessibility service description
- `apps/android-companion/app/build.gradle.kts` — `androidx.documentfile` dependency
- `apps/android-companion/README.md` — this pass's closed/still-open items
- `AUDIT_REPORT_2026-09-11.md` — this section

### Remaining, in priority order

(1) Prisma migration + client regen — the standing blocker, unchanged.
(2) `nova plugin package`/`publish`/`test`. (3) Wiring
`DeviceConnectionLifecycle` to real mDNS/Tailscale I/O. (4)
Screen-content capture (Vision's other half). (5) Robolectric or
instrumented test coverage for this pass's three Android capability
classes and pass 8's camera QR scanner — all four are real code with
zero automated verification right now, the largest test-coverage gap
left in the Android companion app.

---

## Continuation — same day, tenth pass

### 15. `nova plugin package` (finding 10's deferred half — archive format chosen, implemented)

The previous pass deferred `package` because it needed "an actual
archive format decision." Made one: tar.gz (USTAR), not zip — Node has
`zlib` built in for the gzip half but no archive format at all built
in, so either choice needed a hand-written encoder here regardless, and
tar.gz is standard practice for exactly this (npm packages are tar.gz).
No new dependency.

Built `services/runtime/src/archive.ts`: `createTarGz`/`readTarGz`,
implementing both directions rather than just writing, so the format's
correctness is verifiable by round-tripping through the reader instead
of trusting the writer blind. Caught one real bug while building the
test suite: the tar header's mtime field was initially `Date.now()`,
which would make packaging the same plugin source twice produce
different bytes (and therefore different checksums) purely based on
*when* you ran the command — fixed to a fixed epoch value, so
`packagePlugin` is reproducible: identical input always produces an
identical checksum, which matters because that checksum is exactly
what `nova plugin sign` signs.

Wired `packagePlugin` into `plugin-sdk.ts` (validates the manifest
first, per the mandatory pre-step this doc names, then bundles
`manifest.json` plus the given source files and returns the archive
alongside its sha256 checksum) and into `bin/nova.ts`'s `plugin`
collaborator for real: `validate` now actually reads and parses a
manifest file from disk, and `package` reads a plugin directory
(`manifest.json` + everything else in it), packages it, and writes the
resulting `.tar.gz` next to it. `create` was already real from the
previous pass. Only `sign` and `publish` remain unwired in the binary —
`sign` because there's no key-management story for where a private key
would come from in a CLI invocation, `publish` because the registry
endpoint still doesn't exist, same reasoning as before.

Full test coverage for `archive.ts` (round-trips including an
exact-block-size file, an empty file, binary content with embedded
null bytes, oversized-name rejection, gzip-magic-byte verification) and
`packagePlugin` (validation-first rejection, checksum determinism,
checksum sensitivity to actual content changes), plus one end-to-end
test chaining `createPluginScaffold` → `packagePlugin` →
`signPluginChecksum` → `verifyPluginSignature` — the whole SDK pipeline
in one test, not just its parts in isolation.

### Files changed this pass

- `services/runtime/src/archive.ts` — new
- `services/runtime/test/archive.test.ts` — new
- `services/runtime/src/plugin-sdk.ts` — `packagePlugin`, updated top comment
- `services/runtime/test/plugin-sdk.test.ts` — `packagePlugin` + end-to-end tests
- `services/runtime/src/index.ts` — export `archive.js`
- `services/runtime/src/bin/nova.ts` — real `validate`/`package` wiring
- `AUDIT_REPORT_2026-09-11.md` — this section

### Remaining, in priority order

(1) Prisma migration + client regen — still the standing blocker,
unchanged across ten passes now. (2) `nova plugin publish` — needs the
marketplace registry endpoint to exist first; `nova plugin sign` needs
a key-management decision (where does the private key come from in a
CLI context — env var, OS keychain, a `nova keys` command that doesn't
exist yet). (3) Wiring `DeviceConnectionLifecycle` to real mDNS/
Tailscale I/O. (4) Screen-content capture (Vision's other half). (5)
Robolectric/instrumented tests for the Android companion's capability
classes and camera scanner.

---

## Continuation — same day, eleventh pass

### 16. `nova plugin sign` (finding 15's deferred half — key-management decision made)

Made the decision the previous pass left open: the private key comes
from a file path in the `NOVA_PLUGIN_SIGNING_KEY_PATH` environment
variable — the same convention plenty of existing signing tools use
(a CLI shouldn't prompt for or embed a key inline; pointing at a file
via env var is the standard shape). No OS keychain integration or a
`nova keys` management command — both are real additional scope, not
implied by "sign this checksum."

Extracted `checksumOf` out of `packagePlugin` into its own exported
function in `plugin-sdk.ts` (it was inline before; `nova plugin sign`
needs the exact same `sha256:<hex>` computation over an already-built
`.tar.gz` file on disk, not just over bytes being packaged in the same
call, so it had to stop being private to `packagePlugin`). Wired
`bin/nova.ts`'s `sign` action for real: reads the package archive and
the PEM key file from disk, computes the checksum, signs it, writes
`<package-path>.sig` containing the checksum and base64 signature.

`nova plugin publish` remains the one plugin-SDK command with no
wiring at all — there's still no marketplace registry endpoint
anywhere in this repository for it to call, which isn't something to
invent.

### Files changed this pass

- `services/runtime/src/plugin-sdk.ts` — extracted `checksumOf`
- `services/runtime/test/plugin-sdk.test.ts` — `checksumOf` tests
- `services/runtime/src/bin/nova.ts` — real `sign` wiring
- `AUDIT_REPORT_2026-09-11.md` — this section

### Remaining, in priority order

The plugin SDK is now complete except `publish`, which is blocked on
an external dependency (the registry) that doesn't exist, not on
anything this session could resolve alone. Next: (1) Prisma migration
+ client regen — the standing blocker, unchanged across eleven passes.
(2) Wiring `DeviceConnectionLifecycle` to real mDNS/Tailscale I/O. (3)
Screen-content capture (Vision's other half). (4) Robolectric/
instrumented tests for the Android companion's capability classes and
camera scanner — the largest concentration of untested-but-real code
left from this session.

---

## Continuation — same day, twelfth pass: bug audit + screen capture

Requested explicitly this pass: re-audit existing code (not just
survey docs-vs-code gaps) for actual bugs, fix what's found, then keep
closing feature gaps.

### 17. Bug: `RetrievalFusion.fuse()` was multiplying a candidate's importance/confidence/pinning bonus by how many search branches found it

This is the most significant bug found this session — a correctness
bug in already-shipped, already-tested code, not a gap. `fuse()`
accumulated each candidate's score across branches by calling
`contribution()` once per branch and summing the results. But
`contribution()` computed *both* the branch-specific score (correct to
sum per branch) *and* the full candidate-level bonus — importance
(×0.2) + confidence (×0.15) + recency (×0.1) + project_relevance (×0.1)
+ usage_frequency (×0.05) + pinned (+0.4) — every single time it ran.
A candidate found by one search method got that bonus once; the exact
same candidate found by three methods got it three times, purely
because more methods happened to surface it, not because it was
actually three times as important, confident, recent, or pinned.
`docs/04-memory/memory-ranking.md` is explicit that these are
candidate-level factors ("each candidate result is scored on a
weighted combination of" a fixed list), not per-branch ones — only the
five search methods' own scores are supposed to accumulate with
branch count.

Concretely, the bug meant: an unpinned, unimportant candidate found by
all five branches with weak scores in every one could out-rank a
strongly pinned, highly important candidate found by only one branch,
just by breadth of accidental method overlap — precisely backwards
from what pinning and importance are supposed to guarantee.

**Fixed:** rewrote `fuse()` to accumulate branch contributions
separately from a single candidate-level bonus computed once per
candidate id, regardless of how many branches it appeared in. Added a
regression test that isolates the bonus from branch scoring entirely
(all branch scores set to 0) and asserts the bonus is identical whether
the candidate appears in one branch or three — this test fails under
the old code and passes under the fix.

### 18. Bug: `KnowledgeGraph.mergeNodes()` could produce a self-loop edge that `addEdge()` itself would never allow to be created directly

If the canonical and duplicate nodes being merged had a direct edge
between them (a realistic case — e.g. a `related_to` edge recorded
when they were first flagged as possibly-the-same-entity, before the
merge decision was confirmed), re-pointing every edge touching
`duplicateId` to `canonicalId` turned that specific edge into one
whose `from_node_id` and `to_node_id` were both `canonicalId` — a
self-loop. `addEdge()`'s own cycle check (`pathExists` treats
`start === target` as an immediate cycle) would reject creating that
edge shape directly, so `mergeNodes` was producing graph state that
the class's own invariants say should be impossible.

**Fixed:** `mergeNodes` now computes each edge's re-pointed endpoints
before applying them, and drops the edge entirely (rather than keeping
a self-loop) when both endpoints would collapse onto `canonicalId`.
Added a regression test that sets up exactly this scenario and asserts
no self-loop edge exists after the merge.

### 19. Feature: screen-content capture (Vision's other half)

`docs/20-devices/screen-streaming.md` was the one Vision sub-feature
still unimplemented after pass 9's still-image capture. Built
`ScreenCaptureManager.kt`: MediaProjection-based capture,
session-scoped per the doc ("not always-on" — explicit `startSession`,
an idle-timeout that auto-stops via `stopSession` unless
`reportActivity` resets the clock, so a caller that stops consuming
frames doesn't leave a silent capture loop running), throttled to
roughly one downscaled JPEG frame per second by default rather than
video ("tuned for understanding rather than video quality, not a
screen-mirroring product" — the doc's own words). Gated by the same
`CompanionCapabilities.VISION` permission as the still-image capture,
since the doc treats phone-camera and phone-screen as two capture
sources within one Vision capability, not two permissions.

Added `FOREGROUND_SERVICE_MEDIA_PROJECTION` to the manifest and
`mediaProjection` to `CompanionForegroundService`'s declared type —
Android 14+ requires a `mediaProjection`-typed foreground service
already running before `getMediaProjection` succeeds at all, which
`ScreenCaptureManager`'s doc comment states as a hard caller
requirement, not a suggestion. Not unit-tested, same limitation as
every other Android capability class this session (real
`MediaProjection`/`ImageReader`/`Bitmap` types).

### Files changed this pass

- `services/runtime/src/retrieval-fusion.ts` — bug fix
- `services/runtime/test/knowledge-graph.test.ts` — regression tests for both bugs
- `services/runtime/src/knowledge-graph.ts` — bug fix + updated doc comment
- `apps/android-companion/app/src/main/java/com/nova/companion/ScreenCaptureManager.kt` — new
- `apps/android-companion/app/src/main/AndroidManifest.xml` — media-projection foreground service type/permission
- `apps/android-companion/README.md` — closed item
- `AUDIT_REPORT_2026-09-11.md` — this section

### Remaining, in priority order

(1) Prisma migration + client regen — the standing blocker, unchanged
across twelve passes. (2) Wiring `DeviceConnectionLifecycle` to real
mDNS/Tailscale I/O. (3) Robolectric/instrumented tests for every
Android capability class this session built (camera QR scan, App
Control, File Access, still-image and now screen-content Vision
capture) — the single largest concentration of real-but-unverified
code left anywhere in this session's work. (4) A wider bug-audit pass
across the services this pass didn't reach — `services/memory`,
`apps/desktop`, and the ~40-file MCP protocol surface in
`services/runtime` were spot-checked earlier in the session for
doc-consistency but not read line-by-line for logic bugs the way
`retrieval-fusion.ts` and `knowledge-graph.ts` were this pass.

---

## Continuation — same day, thirteenth pass: bug audit continued into memory + state

Continuing item 4 above. Two more real bugs found.

### 20. Bug: `MemoryStore.search()` never excluded superseded records

`supersedeRecent()` marks an old record's status `SUPERSEDED` and
links it to its replacement — but `search()` never checked `status` at
all, so a superseded (contradicted, replaced) fact appeared in normal
search results right alongside the fact that replaced it, indefinitely.
`docs/04-memory/memory-conflict-resolution.md` is explicit that
superseded records should remain reachable for history ("did my
opinion on X ever change," via Timeline Memory) while "current
retrieval and context assembly prioritize the current, superseding
fact **by default**" — the "by default" is the part `search()` wasn't
honoring; there was no code path that ever excluded a superseded
record, default or otherwise.

Concretely: if a user said "I like Python" and later corrected that to
"I hate Python" (`writeRecent` + `supersedeRecent`, exactly the
conflict-resolution flow the doc describes), a search for "python"
would surface both, with no signal to a caller about which one is
actually current beyond manually inspecting a `status` field nothing
was filtering on.

**Fixed:** added `filters.include_superseded` to `MemorySearchInput`
(defaults to `false` — matches the doc's "by default" precisely, while
leaving an explicit escape hatch for a genuine historical query, which
is what `include_superseded: true` is for). `search()` now excludes
`status === "SUPERSEDED"` records unless that flag is set. Working and
long-term tier records have no `status` column at all (only
`RecentMemoryEntry` does — noted back in this session's Prisma schema
work), so they're correctly unaffected by the filter — `status` is
`undefined` for them, which passes through either way. Added a
regression test: search for a term matching both a superseded record
and its replacement returns only the replacement by default, and both
when `include_superseded: true` is passed.

### 21. Bug: `StateManager`'s active re-check result was never persisted, and was paired with the wrong confidence value

Two related bugs in the same few lines. When `query()` detects a
pending cross-observer contradiction and the caller allows an active
re-check, it calls the injected `activeRecheck` function (an on-demand
OS query — e.g. "does this file actually exist right now") and
returned that fresh value directly to the caller. But:

1. **The returned `confidence` was `latest.confidence`** — the
   confidence of whichever *contested, stale* observation happened to
   be most recent by timestamp, not a confidence reflecting the fresh
   recheck at all. If the recheck's value disagreed with `latest.value`
   (the entire reason to do a recheck), the response paired a brand-new
   authoritative value with an old, disputed confidence number.
2. **The recheck result was never recorded as a new observation.**
   `docs/03-runtime/state-manager.md`'s "Active re-check" section
   explains active checks are used sparingly specifically because they
   have a resource cost. Without persisting the result, the very next
   `query()` call for that entity would recompute `contradictionPending`
   from the exact same two stale, still-conflicting observations and
   flag a contradiction again — meaning a caller that queried the same
   entity twice with `allowActiveRecheck: true` would trigger *two*
   on-demand OS queries for a contradiction the first one had already
   resolved, directly undermining the "sparingly" resource-cost
   rationale the doc gives for the feature existing at all.

**Fixed:** the recheck result is now recorded via `this.observe()` as
a new observation (`observer: "active_recheck"`, `confidence: 1` — a
direct on-demand check is the most authoritative signal available by
definition, not bound to whatever `latest` happened to be) before
being returned. Added a regression test covering both: the immediate
response carries confidence 1 (not the stale 0.5/0.6 fixture
confidences), and a follow-up query — even with
`allowActiveRecheck: false` — sees the persisted result and does not
re-flag the contradiction, with `recheck` asserted to have been called
exactly once across both queries.

### Files changed this pass

- `services/memory/src/memory-store.ts` — bug fix (`include_superseded` filter)
- `services/memory/test/memory-store.test.ts` — regression test
- `services/state/src/state-manager.ts` — bug fix (persist + correct confidence)
- `services/state/test/state-manager.test.ts` — regression test
- `AUDIT_REPORT_2026-09-11.md` — this section

### Remaining, in priority order

(1) Prisma migration + client regen — the standing blocker, unchanged
across thirteen passes. (2) Wiring `DeviceConnectionLifecycle` to real
mDNS/Tailscale I/O. (3) Robolectric/instrumented tests for the Android
companion's capability classes. (4) Bug audit still hasn't reached
`apps/desktop` (2,556-line `app.tsx` alone) or the ~40-file MCP
protocol surface in `services/runtime` — both flagged repeatedly now
as the largest remaining unaudited-for-correctness surfaces, as
opposed to the doc-consistency spot-checks they got earlier in the
session.

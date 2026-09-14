# Skill Learning

## Purpose

Turns a successfully completed task into a durable, reusable capability
without a manual training step, so NOVA's baseline competence compounds
over time rather than resetting to the same starting point every session.
This is the policy layer for the single largest capability gap identified
against the field (`docs/references/feature-gap-analysis.md`, §1): every
competitor agent surveyed resets to day-one capability on day 100. A
closed learning loop is a structural product difference, not an
incremental feature, and it is the highest-leverage item in NOVA's
autonomy roadmap for that reason.

## Scope

The policy and data model for extracting, storing, matching, and
retiring learned Skills. The extraction mechanism itself lives in
`services/runtime/src/skill-extractor.ts`; this document defines what a
Skill is, when one may be created, and the safety boundary that
extraction can never cross. Retrieval-time matching against the
Planner's normal planning path is scoped here at the policy level; the
Planner's own planning logic is `docs/03-runtime/planner.md`.

## What counts as "successfully completed"

A task is eligible for skill extraction only if it received a
**Verified: Completed** outcome from the Verifier
(`docs/03-runtime/verifier.md`) — never merely "did not error out," and
never an **Unverified** outcome, which the Verifier already treats as
distinct from success. This is the same standard the rest of NOVA uses
to separate confirmed success from silent failure
(`docs/01-product/success-metrics.md`), applied here to gate learning
rather than just reporting: extracting a skill from an unverified or
merely-didn't-crash execution would teach NOVA to reliably repeat a
result nobody confirmed actually worked.

## The Skill record

A Skill generalizes one specific successful trajectory into a reusable
template. It contains:

- **Trigger description** — a natural-language description of the goal
  this skill addresses, embedded for semantic matching against future
  goals using the same `embeddings` table and matching approach
  `docs/04-memory/entity-resolution.md` uses for entity mentions.
- **Step template** — the generalized step sequence, with concrete
  arguments from the original trajectory replaced by typed parameter
  slots (e.g. a specific file path becomes a `{file_path}` slot).
- **Required permission scopes** — the exact set of tool permission
  scopes the template's steps invoke, recorded at extraction time.
- **Success/failure counters and a decay-weighted confidence score** —
  updated every time the skill is reused, per the decay policy below.
- **Provenance** — the source `WorkflowExecution`/task id the skill was
  originally extracted from, and every task id it has since been reused
  for, preserving a full lineage rather than an opaque black box.

## Extraction pipeline

Extraction hooks into `services/runtime/src/workflow-engine.ts`'s
existing checkpoint mechanism rather than adding a new tracking system:
a completed, Verifier-passed `WorkflowExecution` already carries its
full step history via `WorkflowCheckpoint.completedNodeIds` and
`context`. `skill-extractor.ts` consumes this directly. Generalization —
turning concrete arguments into typed parameter slots — uses a
narrowly-scoped LLM call whose only job is "generalize this trajectory
into a reusable template," deliberately separate from whichever model
executed the original task, so extraction cost stays small and the
extraction step can be swapped, disabled, or rate-limited independently
of task execution.

Not every completed task should become a skill candidate: extraction is
additionally gated on the task representing a non-trivial, potentially
repeatable sequence (more than a single tool call, per a configurable
minimum step count) — a one-step action is not worth generalizing and
would only add noise to the Skill store.

## Retrieval and reuse

When the Planner receives a new goal, it checks for a matching learned
skill using the same shape `docs/04-memory/entity-resolution.md` already
uses for text mentions: semantic match against `trigger_description`,
then a confidence/ambiguity-margin gate before trusting the match. A
high-confidence match is offered to the Planner as a candidate plan; an
ambiguous or low-confidence match falls through to normal from-scratch
planning. A matched skill is never executed silently in place of
planning — it is surfaced as the Planner's starting plan, still subject
to the Executor and Verifier exactly as any other plan would be
(`docs/03-runtime/planner-executor-contract.md`), so a bad generalization
is caught by the same verification loop that would catch a bad
from-scratch plan.

## Safety boundary: skills never bypass permissions

A learned skill's `required_permission_scopes` are recorded, not
pre-authorized. At reuse time, the skill re-requests every permission it
needs through the normal Permission Manager flow
(`docs/03-runtime/permission-manager.md`, `docs/10-security/permissions.md`)
exactly as if it were being requested for the first time. Learning a
skill must never learn a shortcut around a permission gate — this is
stated explicitly because a self-improving capability that could also
self-escalate its own access would turn a headline feature into a
privilege-escalation vector. This boundary is non-negotiable regardless
of how proven or high-confidence a skill becomes.

## Decay and pruning

A skill's confidence score is decay-weighted: repeated successful reuse
raises it, and a failure lowers it faster than a success raises it,
consistent with the principle that a false "success" is worse than a
visible failure (`docs/03-runtime/verifier.md`). When `failure_count`
climbs past a threshold relative to `success_count`, the skill is
**demoted**, not deleted — it stops being offered to the Planner but
remains in the store with its full history intact, matching the
inactive-not-deleted pattern `docs/04-memory/knowledge-graph.md`'s node
merging already uses. This preserves an audit trail of what NOVA tried
and stopped trusting, rather than silently erasing the evidence.

## Storage

Skills extend the existing Prisma schema (`services/memory/prisma/schema.prisma`)
with a `Skill` model: `id`, `workspace_id`, `identity_id`,
`trigger_description` (+ embedding), `step_template_json`,
`required_permission_scopes_json`, `success_count`, `failure_count`,
`last_used_at`. This is additive to the existing schema and requires a
standard `prisma migrate dev` pass — no schema redesign.

## Relationship to the plugin system and to Self-Growing Capability

A Skill is not a plugin and does not grant itself new capability the way
`self-growing-capability.md`'s three growth mechanisms do — it only ever
recombines already-permitted tool calls the same way a Composite Tool
does. The two mechanisms are complementary and eventually converge: a
sufficiently proven skill (high success count, reused across many
sessions) is exportable as an actual plugin via
`services/runtime/src/plugin-sdk.ts`'s `createPluginScaffold`, turning
"the agent learned something" into something the user can inspect,
share, or version-control — closing a loop that an opaque, black-box
learning system cannot offer, and consistent with the transparency-first
design the rest of NOVA's memory and knowledge systems already follow.

## Related documents

- `docs/references/feature-gap-analysis.md` — the competitive analysis this document implements (§1)
- `self-growing-capability.md` — the complementary capability-acquisition mechanisms (install/compose vs. learn-from-doing)
- `strategy-evaluation.md` — comparing and retiring strategies once multiple exist for the same goal
- `docs/03-runtime/verifier.md` — the success signal that gates extraction
- `docs/03-runtime/planner.md`, `docs/03-runtime/planner-executor-contract.md` — where matched skills are offered as candidate plans
- `docs/04-memory/entity-resolution.md` — the semantic-matching pattern reused for trigger matching
- `docs/10-security/permissions.md`, `docs/03-runtime/permission-manager.md` — the re-request boundary skills can never bypass
- `services/runtime/src/workflow-engine.ts`, `services/runtime/src/skill-extractor.ts`, `services/memory/prisma/schema.prisma` — implementation hook points

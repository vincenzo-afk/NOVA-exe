# Specialist Delegation and Programmatic Tool-Call Collapsing

## Purpose

Closes the two genuinely new pieces of the multi-agent gap against
Hermes Agent's "Bot Mode" and OpenClaw's shared sessions
(`docs/references/feature-gap-analysis.md`, row 5): routing a request to
a named specialist via @mention inside a channel, and collapsing a
known-shape multi-step tool pipeline into a single execution round-trip
instead of one Planner round-trip per step. The underlying concurrent-
execution mechanism itself is not new — see the verification note below.

## Verification note

The base capability this document extends — spawning isolated,
permission-scoped concurrent agent instances for a decomposed task — is
**already specified and, per this session's audit, correctly scoped**:
`multi-agent-collaboration.md` already defines the Planner/Task Manager
coordination model, permission inheritance, conflict handling via the
Resource Manager, and Task Monitor visibility. The prior uncertainty
flagged in `feature-gap-analysis.md` about whether an orchestration
module exists is resolved by that document: it does. This document does
not redefine that mechanism; it adds two capabilities on top of it.

## Scope

Two additive features on top of `multi-agent-collaboration.md`'s
existing coordination model:

1. A routing layer that lets a channel message address a specific
   spawned agent instance by name.
2. A fast execution path that skips a full Planner round-trip per step
   for a pipeline whose shape is already known upfront.

Neither changes the permission-inheritance or conflict-handling rules
already established in `multi-agent-collaboration.md` — both operate
strictly within them.

## Specialist @mention routing

NOVA's Channel Adapter interface (`messaging-platforms.md`,
`channel-adapter-expansion.md`) already handles inbound messages from
Telegram, Discord, WhatsApp, and the platforms being added under
channel expansion. This document adds a routing layer on top of that
existing interface: a spawned agent instance from a multi-agent task
(per `multi-agent-collaboration.md`) may be given a **channel identity**
— a name it responds to when @mentioned in a group conversation on a
supporting platform. This is purely a routing convenience over the
existing coordination model: an @mention resolves to the corresponding
spawned agent's Task Manager entry, and the message is delivered to that
specific subtask's context rather than to the parent task generally. No
new per-platform integration work is required — this is one routing
layer sitting on top of the Channel Adapter interface that already works
across every current and planned adapter.

Channel identities are opt-in per multi-agent task (not automatic for
every spawned agent) and are torn down when the parent task completes,
consistent with spawned agents' existing scoped, non-persistent nature
in `multi-agent-collaboration.md`.

## Programmatic tool-call collapsing

For a task whose full step sequence is already known upfront — a
known-shape pipeline, not an exploratory one requiring the Planner to
decide each next step based on the previous result — requiring a full
Planner round-trip per tool call is unnecessary overhead. This document
adds a fast path: an ordered sequence of tool calls, with data flowing
between them (a small DAG, similar in spirit to what
`services/runtime/src/workflow-engine.ts` already executes), can be
submitted and executed **server-side in one pass**, only returning to
the model once for the final result, or immediately on any actual branch
condition or failure the sequence couldn't anticipate.

This is a thin layer over the existing Workflow Engine, not a new
execution primitive — the engine already executes DAGs of steps with
timeout handling and parallel-branch support. What this adds is
specifically the ability to skip the Planner round-trip between nodes
when the entire sequence was specified upfront, rather than the engine's
normal mode of consulting the Planner between steps.

**This fast path never bypasses verification or permissions.** Every
step in a collapsed pipeline still passes through the Verifier
(`docs/03-runtime/verifier.md`) and still requires whatever permission
scope it would have required as an individually-planned step — collapsing
removes Planner round-trips between steps, not the safety checks on each
step. A collapsed pipeline that hits a step requiring a permission not
already granted pauses for confirmation exactly as an individually
planned task would.

## When to use which path

The Planner decides whether a task is eligible for collapsing at plan
time: a pipeline is eligible only when its full shape can be determined
upfront with no step genuinely depending on runtime information the
Planner couldn't anticipate (e.g., "fetch these five files and convert
each to PDF" is eligible; "investigate this bug and fix whatever you
find" is not, since the fix depends on what's found). This mirrors the
same distinction `multi-agent-collaboration.md` already draws between
genuinely independent, parallelizable subtasks and sequentially
dependent ones — collapsing is the low-uncertainty case's optimization,
not a default.

## Related documents

- `docs/references/feature-gap-analysis.md` — the competitive analysis this document implements (row 5)
- `multi-agent-collaboration.md` — the base coordination model this document extends, unchanged
- `messaging-platforms.md`, `channel-adapter-expansion.md` — the Channel Adapter interface @mention routing sits on top of
- `docs/17-workflow/workflow-engine.md` — the DAG execution engine the collapsing fast path reuses
- `docs/03-runtime/verifier.md`, `docs/10-security/permissions.md` — the per-step checks collapsing never bypasses
- `docs/03-runtime/planner.md` — where eligibility for the fast path is decided at plan time

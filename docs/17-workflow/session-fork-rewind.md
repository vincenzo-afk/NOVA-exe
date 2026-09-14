# Session Fork and Rewind

## Purpose

Exposes the Workflow Engine's existing checkpoint data as a user-facing
"fork from here and try something else" feature — closing the gap
against OpenClaw's Session Rewind and Branching, and going further by
using NOVA's Verifier to tell the user which branch actually worked
better, not just that branching is possible
(`docs/references/feature-gap-analysis.md`, row 4b).

## Scope

The fork operation, its CLI and desktop surfacing, and branch comparison.
The underlying checkpoint data model is unchanged — `workflow-engine.md`
remains the source of truth for `WorkflowCheckpoint`'s shape
(`completedNodeIds`, `context`, `state`). This document adds an
operation on top of that data, not a new storage layer.

## What already exists

`WorkflowCheckpoint` already contains everything structurally needed for
a fork: `completedNodeIds`, a `context` snapshot, and a validity `state`.
Today this data is used exclusively for the crash-recovery path via
`TaskCheckpointStore` — `recoverAfterCrash()` detects tasks stuck
mid-execution at startup and demotes them to `Unverified` rather than
silently resuming, which is already a more conservative recovery policy
than "automatic recovery" as generically described for comparable tools.
The gap is entirely that this same data has no user-facing operation
built on top of it yet.

## The fork operation

`WorkflowEngine.forkFromCheckpoint(checkpointId, newTaskId)` clones a
checkpoint's `context` and `completedNodeIds` into a fresh workflow
execution under a new task id, leaving the original task and its
checkpoint history completely untouched. This is a mechanical operation
given the existing checkpoint shape — no new data needs to be captured
that isn't already captured for crash recovery.

A fork inherits the permission grants already established for the
original task up to the fork point (per `docs/10-security/permission-grant-store.ts`'s
existing grant model) but requests fresh confirmation for any new action
beyond what was already executed and verified in the original run — a
fork is a new task lineage, not a permission-inheriting clone that
bypasses confirmation for actions it hasn't actually performed yet.

## CLI surface

`nova task fork <task-id> [--at <checkpoint-id>]` — forks a task at a
named checkpoint, or at its most recent checkpoint if `--at` is omitted.
Follows the same doc-driven command-tree pattern the rest of the CLI
uses (`docs/27-cli/`), and its output includes the new task id so the
user (or a script) can immediately act on the fork.

## Desktop surface

The existing Task Monitor screen (`docs/40-screens/`) gains a "fork from
here" action attached to each checkpoint in a task's step history — pure
UI work on top of the CLI operation above, no new backend primitive
required beyond `forkFromCheckpoint` itself.

## Branch comparison — the differentiator

Once two forks of the same original task exist, "you can fork" alone is
table stakes once the data model supports it — matching OpenClaw's
feature does not differentiate NOVA from it. The differentiator is a
comparison view: which steps diverged between branches, which tools were
called differently, and — using the existing Verifier infrastructure
(`docs/03-runtime/verifier.md`) — which branch's outcome actually scored
as **Verified: Completed** versus **Failed** or **Unverified**. This
turns "test two strategies side by side" into "and here's which one
provably worked," which is a genuinely stronger claim than branching
alone and is a natural fit for infrastructure NOVA already has for an
unrelated purpose (outcome confirmation).

## Cross-app/native branch switching

OpenClaw's model allows switching branches across web/native apps and
restoring prompt images after a fork. NOVA's equivalent is that a forked
task is simply a new task id in the same Task Manager
(`docs/03-runtime/task-manager.md`) and Memory store — it is visible and
switchable from any NOVA surface (desktop, CLI, mobile companion) the
same way any other task is, with no separate "branch mode" state to
synchronize, because forks are not a special task type, just tasks with
a recorded lineage pointer back to their originating checkpoint.

## Related documents

- `docs/references/feature-gap-analysis.md` — the competitive analysis this document implements (row 4b)
- `workflow-engine.md` — the checkpoint data model this document builds on top of, unchanged
- `docs/03-runtime/task-persistence.md` — the crash-recovery use of checkpoints this document's fork operation reuses without altering
- `docs/03-runtime/verifier.md` — the outcome-scoring infrastructure branch comparison reuses
- `docs/10-security/permission-grant-store.ts` — the grant-inheritance-with-fresh-confirmation model forks follow
- `docs/27-cli/` — the CLI command-tree pattern `nova task fork` follows
- `docs/40-screens/` — the Task Monitor screen gaining the fork action

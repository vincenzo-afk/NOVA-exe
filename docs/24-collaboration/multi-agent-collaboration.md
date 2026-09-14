# Multi-Agent Collaboration

## Purpose

Specifies concurrent, coordinated execution across multiple agent
instances for a single decomposed task, addressing the requirement for
"multiple agents" beyond the v1 single-runtime model.

## Scope

Coordination mechanics built on the existing Planner and Task Manager.
This is an execution mode of the existing runtime, not a second runtime —
per `docs/15-decisions/adr-0008-v5-architecture-evolution.md`, it extends
`docs/03-runtime/planner.md` and `docs/03-runtime/task-manager.md` rather
than introducing a parallel system.

## When it triggers

The Planner decomposes a task into a multi-agent plan when subtasks are
genuinely independent and parallelizable — e.g., "research this topic
while refactoring that code" — rather than as a default execution mode
for ordinary requests. Sequential dependency between subtasks keeps
execution single-agent, since coordination overhead isn't justified when
one agent finishing before the next starts is required anyway.

## Coordination model

Each spawned agent instance is a full Planner/Executor pair operating
under its own scoped Task Manager entry
(`docs/03-runtime/task-manager.md`), communicating exclusively through
the existing event bus (`docs/02-architecture/event-bus-specification.md`)
— agents do not share mutable in-memory state directly. A coordinating
**parent task** tracks subtask status and merges results once all
branches report completion or failure.

## Permission scope

Each spawned agent instance inherits the permission scope of the task
that spawned it — per `docs/05-ai/planner-agent.md`'s existing rule that
an agent cannot exceed the permission scope of its invoking context, this
is not loosened for spawned agents. No agent instance can grant itself or
a sibling broader access than the parent task already had.

## Conflict handling

Where two concurrent agents could act on the same resource (e.g., both
editing the same file), the Resource Manager
(`docs/03-runtime/resource-manager.md`) enforces the same locking/
contention rules it already applies to any concurrent tool access — this
is not a new conflict model, only a new source of concurrent requests to
an existing arbitration mechanism.

## Visibility

The Task Monitor UI (`docs/09-ui/task-monitor.md`) shows a multi-agent
task as a single parent entry with expandable subtask branches, each
showing its own progress and status, so a user is never left trying to
correlate multiple unrelated-looking task entries back to one request.

## Failure handling

If a subtask fails, the parent task's behavior (abort all remaining
branches vs. continue with partial results) follows the same
failure-recovery policy already defined in
`docs/03-runtime/failure-recovery.md`, extended to a branch-aware version
rather than a new policy.

## Related documents

- `docs/25-failure-modes/FM-03-agent-orchestration-and-collaboration.md` — failure modes for this subsystem
- `docs/03-runtime/planner.md`, `docs/03-runtime/task-manager.md` — the
  runtime this extends
- `docs/02-architecture/event-bus-specification.md` — inter-agent
  communication mechanism
- `docs/03-runtime/resource-manager.md` — shared-resource arbitration
- `docs/09-ui/task-monitor.md` — multi-agent visibility
- `docs/24-collaboration/specialist-delegation.md` — @mention channel
  routing to a spawned agent, and the programmatic tool-call collapsing
  fast path, both built on top of this document's coordination model
  without altering it

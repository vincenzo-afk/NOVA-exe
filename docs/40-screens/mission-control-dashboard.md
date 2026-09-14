# Mission Control Dashboard

## Purpose

Adds a pinnable, multi-agent live dashboard to the desktop app — see
every running task and specialist agent updating in real time on one
screen — closing the gap against OpenClaw's Interactive MCP Apps /
"Mission Control" concept (`docs/references/feature-gap-analysis.md`,
row 7). This is a rendering feature built entirely on data NOVA already
produces, not a new data pipeline.

## Scope

The desktop-app Dashboard view, its data source, and pin persistence.
The underlying task, tracing, and multi-agent data models are unchanged —
this document adds a visualization surface on top of them.

## Relationship to the existing Task Monitor

The desktop app already has a Task Monitor screen
(`docs/40-screens/workflow-screen.md`) showing task status, including
multi-agent tasks as an expandable parent-with-subtasks entry
(`multi-agent-collaboration.md`). Mission Control is not a replacement
for the Task Monitor — it is a different view optimized for a different
use case: the Task Monitor is a list you search and drill into; Mission
Control is a small number of **pinned live tiles** meant to sit visible
at a glance while other work happens, the way OpenClaw's dashboard lets
a user watch a sales agent, a research agent, and a support agent
simultaneously without actively navigating between them.

## Data source

Mission Control subscribes to the same structured tracing event stream
already built for observability (`packages/shared/src/tracer.ts`,
`FileSpanStore`) rather than a new data pipeline. Each live tile renders
one active `correlation_id`/task, keyed off the `nova.task` span's
already-required fields (`task_id`, `task_type`, `workspace_id`) —
because this data is already real and already flowing for tracing
purposes, Mission Control is purely a rendering feature: no new backend
primitive is required to make it work, only a subscription and a tile
layout.

## Tile contents

Each pinned tile shows, at minimum:

- Current task status (per the Verifier's three-outcome model where
  applicable — Verified/Failed/Unverified/still executing).
- The most recent progress span, so a long-horizon task
  (`long-horizon-execution.md`) shows *what it's currently doing*, not
  just a spinner.
- For a multi-agent parent task, a compact per-subagent status summary,
  reusing the same parent/subtask relationship `multi-agent-collaboration.md`
  already defines rather than inventing a separate grouping model.
- A link into the full Task Monitor entry for anyone who wants to drill
  down past the at-a-glance view.

## Pin persistence

"Pinned" state is a small, locally persisted list of task/dashboard-tile
identifiers in desktop app state — it does not require a new backend
storage primitive, since it is purely a per-user display preference, not
data about the task itself. Pins are scoped per NOVA installation, not
synced as durable cross-device state, consistent with the dashboard
being a live view rather than a record — an entry unpins itself
automatically once its underlying task completes and is no longer
active, unless the user explicitly re-pins it to review results.

## Interactive tiles — where NOVA can differentiate

OpenClaw's Interactive MCP Apps specifically emphasizes tickceted
applications with bound tools and resources, not just passive status
tiles. Where a running task exposes an interactive surface (for
example, a task awaiting a permission confirmation, or a plugin with its
own bound UI per `docs/16-extensibility/`), Mission Control renders that
interaction inline in the tile rather than requiring the user to
navigate elsewhere to respond — turning the dashboard into an actual
control surface, not only a status board. This reuses the same
permission-confirmation UI already defined in
`docs/10-security/permissions.md` rather than a bespoke inline
confirmation flow.

## Related documents

- `docs/references/feature-gap-analysis.md` — the competitive analysis this document implements (row 7)
- `docs/40-screens/workflow-screen.md` — the existing Task Monitor screen this document complements, not replaces
- `multi-agent-collaboration.md` — the parent/subtask model Mission Control's multi-agent tiles reuse
- `packages/shared/src/tracer.ts` — the tracing event stream this dashboard subscribes to
- `long-horizon-execution.md` — the progress-surfacing behavior Mission Control tiles visualize for long-running tasks
- `docs/10-security/permissions.md` — the confirmation UI reused for inline interactive tiles

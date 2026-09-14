# Command Palette

## Purpose

A fast, keyboard-driven interface for direct commands and quick lookups,
serving the Developer and AI Engineer personas'
(`docs/01-product/user-personas.md`) preference for keyboard-first
interaction over conversational phrasing for routine, well-understood
tasks.

## Scope

Command-palette-specific interaction conventions. Shared cross-surface
conventions are `ui-overview.md`.

## Interaction model

A single text input with type-ahead suggestions drawn from: recently used
commands, deterministically resolvable actions (file open, git commands,
per `docs/05-ai/deterministic-first.md`'s worked examples), and fuzzy-
matched project/file/entity names resolved through the same Entity
Resolution mechanism used elsewhere (`docs/04-memory/entity-resolution.md`).

## Preference for deterministic resolution

Because command palette input is typically terse and specific ("open
config.json," "git status"), it disproportionately hits
`docs/05-ai/deterministic-first.md`'s deterministic-resolution path
compared to the more conversational Chat interface — this is a natural
consequence of the input style, not a separate resolution mechanism
specific to this surface; the same Planner logic applies uniformly.

## Result display

Deterministic actions execute and display their structured result
(`docs/06-tools/tool-interface.md`) immediately in a compact format.
Actions requiring confirmation surface the same shared confirmation
treatment as any other surface (`docs/10-security/permissions.md`,
`ui-overview.md`) before proceeding, even in this fast-interaction
context — speed of interaction does not exempt an action from its
risk-tier gate.

## Recency and frequency ranking

Suggested commands are ranked using the same usage-frequency and recency
factors as general memory ranking (`docs/04-memory/memory-ranking.md`),
so commands the user runs often surface higher in type-ahead suggestions
over time, without requiring manual configuration of favorites.

## Related documents

- `docs/25-failure-modes/FM-22-user-interaction-and-analytics.md` — failure modes for this subsystem
- `docs/30-design/command-palette.md` — the visual/grouping treatment
  (result grouping into Actions/Screens/Recent/Memory, inline shortcut
  display) this document's interaction model renders through
- `ui-overview.md` — shared cross-surface conventions
- `docs/05-ai/deterministic-first.md` — the resolution path this surface
  disproportionately exercises
- `docs/04-memory/memory-ranking.md` — suggestion ranking factors
- `docs/09-ui/quick-input-surfaces.md` — the OS-wide global hotkey trigger that opens directly into this same resolution pipeline

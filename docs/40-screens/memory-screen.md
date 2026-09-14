# Memory Explorer — Screen Spec

## Purpose

Browse, search, and correct NOVA's stored memory and knowledge graph, with full lineage visibility.

## Layout

Primary content region + persistent sidebar nav; see `docs/30-design/navigation.md`. Specific layout detail is implementation-defined against `docs/30-design/design-tokens.md`, not hardcoded here.

## Components used

See `41-components/` for the shared components this screen composes; this screen does not define any one-off component — new visual patterns are added to the component library first.

## Interactions

Primary actions and their keyboard equivalents are listed in `docs/29-product/keyboard-shortcuts.md`.

## Required states (every screen must implement all of these — see `docs/45-code-perfection-failure-modes/09-ui-and-state-binding.md` item 5)

- Loading
- Empty (with reason + next action)
- Populated
- Error (mapped to `docs/26-system-reference/06-error-catalog.md`)
- Offline / degraded
- Permission denied (if applicable)
- Partial data (if the underlying query can return incomplete results)

## Accessibility

Screen-reader labels and reduced-motion behavior follow `docs/29-product/accessibility.md`'s per-screen requirement (that document defines them; `docs/30-design/accessibility.md` does not — it covers contrast ratios and visual focus-state styling only, not screen-reader labels or reduced-motion). Focus order and visible focus-state styling follow `docs/30-design/accessibility.md`. Keyboard-only navigation must reach every action on this screen without a mouse.

## Analytics

Emits events per `docs/35-analytics/events.md` for: screen view, primary action taken, error encountered. No event includes raw user content — see `docs/29-product/privacy.md`.

## Related documents

- `docs/04-memory/persistent-user-model.md` — the full index of subsystems
  whose records surface on this screen, and the correctability guarantee
  this screen is the user-facing side of

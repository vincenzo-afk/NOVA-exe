# Context-Aware Suggestion Engine

## Purpose

Specifies the event-driven mechanism behind suggestions like "you have
a meeting in 15 minutes, traffic is heavy," "want me to track this
flight?" after a confirmation is copied, or "want to continue the X
feature?" after reopening an IDE after days away. This is a genuinely
distinct mechanism from its two closest neighbors, not a restatement of
either: `background-life-assistant.md` fires on a **schedule** (a daily
briefing time, a lookahead window before a meeting); this document
fires on an **observed event matching a known pattern**, at the moment
it happens. `adaptive-personalization.md` adapts **how NOVA already
behaves** (tone, timing, defaults); this document is the thing that
decides **whether to say anything at all, right now**, which
`adaptive-personalization.md`'s feedback loop then tunes.

## Scope

Pattern definitions, the matching pipeline, and the confirmation
discipline every fired suggestion goes through. Does not cover the
scheduled-briefing mechanism (`background-life-assistant.md`) or the
timing/frequency learning loop (`adaptive-personalization.md`) — this
document is the trigger layer both of those sit alongside, not on top
of.

## Suggestion patterns

A suggestion pattern pairs an **observable event** with a **candidate
action**, drawn entirely from data NOVA already has permission to
observe — this document defines no new observation surface, only new
reasoning over existing ones (`docs/07-observers/`, calendar/email
adapters, the World Model, `docs/20-devices/physical-environment-integration.md`'s
traffic feed):

- **Calendar + external-feed correlation** — an imminent meeting
  (`calendar-assistant.md`) correlated with current transit conditions
  (`physical-environment-integration.md`'s traffic feed) → "meeting in
  15 minutes, traffic is heavy."
- **Captured-content recognition** — content copied to the clipboard or
  visible in a captured frame matching a known structure (a flight
  confirmation's itinerary format, a shipping tracking number) →
  "want me to track this?"
- **Resumption detection** — reopening a project, file, or application
  after an absence longer than a configurable threshold, correlated
  with the most recent Task Manager entry for that project
  (`docs/03-runtime/task-manager.md`) → "last time you worked on X,
  want to continue?"

New patterns are declarative — an event-shape plus a candidate-action
template — so adding one is a data addition, not new reasoning code,
the same "declarative extension over a fixed engine" shape this project
already uses for tool selection and routing.

## Matching pipeline

An observed event is checked against active patterns using the same
confidence-gated approach `docs/04-memory/entity-resolution.md`
established for text matching and `spatial-perception.md` reused for
vision matching: a high-confidence pattern match surfaces a suggestion;
an ambiguous or low-confidence match is discarded rather than guessed
at. This is a genuinely lightweight, rule-and-correlation layer — it is
explicitly **not** a continuous, always-reasoning background process;
it evaluates on each new relevant observation, not on a polling loop,
consistent with `docs/03-runtime/world-model.md`'s and
`spatial-context.ts`'s precedent against unbounded always-on inference.

## Confirmation and delivery

Every fired suggestion is **opt-in per pattern category** — a user
enables "flight tracking suggestions" or "resume-work suggestions" as
distinct toggles, never a single blanket "enable all proactive
suggestions" switch, so declining one category never silently disables
another the user still wants. A suggestion is always a dismissible
offer, never a silently-taken action — "want me to track this flight?"
requires the same explicit confirmation any other action would, per
`docs/10-security/permissions.md`, regardless of how obviously useful
the suggestion seems. Delivery uses the same configured proactive
channel `background-life-assistant.md` already delivers briefings
through — this document adds no second notification surface.

## Feedback loop

Every suggestion's outcome (accepted, dismissed, ignored) is logged the
same way `background-life-assistant.md`'s briefing engagement already
is, feeding directly into `adaptive-personalization.md`'s existing
proactive-timing adaptation — a pattern category that's consistently
dismissed has its suggestion frequency reduced the same way an
unhelpful briefing cadence would be, through the same existing
mechanism, not a second, parallel learning loop.

## Related documents

- `docs/23-autonomy/background-life-assistant.md` — the scheduled-briefing mechanism this document's event-driven triggering is deliberately distinct from
- `docs/23-autonomy/adaptive-personalization.md` — the feedback loop this document's suggestion outcomes feed into
- `docs/20-devices/physical-environment-integration.md` — the traffic/external-feed source for calendar-correlated suggestions
- `docs/20-devices/spatial-perception.md` — the confidence-gated matching approach this document's pattern matcher reuses
- `docs/04-memory/entity-resolution.md` — the original confidence-tiered matching precedent
- `docs/03-runtime/task-manager.md` — the source for resumption-detection suggestions
- `docs/10-security/permissions.md` — the confirmation requirement every suggestion respects regardless of confidence

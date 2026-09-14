# Keyboard / Mouse Automation (Execution Tier 8)

## Purpose

Describes raw input injection — synthetic keyboard and mouse events sent
directly to the OS — as NOVA's absolute last-resort execution mechanism,
used exclusively in combination with Accessibility or Vision target
identification, never as a standalone targeting mechanism itself.

## Scope

Input-injection mechanics only. Target identification is
`accessibility.md` (structured) or `vision.md` (visual); this tier only
covers translating an identified target and intended action into actual
OS input events.

## Why this is last, not merely low

Every tier above this one carries at least some structural signal about
what is being acted upon and some form of the target application's own
checks. Raw input injection has neither — it is indistinguishable, from
the OS's perspective, from a human physically operating the mouse and
keyboard, which means it carries none of the target application's API-
level or accessibility-level safeguards. This is precisely the fallback
the project's foundational review flagged as capable of functioning as a
guardrail bypass if used loosely — the mitigation is that this tier is
reached only after every higher tier has been confirmed unavailable
(`execution-priority.md`), and only for applications on the explicit
Vision allow-list (`vision.md`).

## Pre-action window/focus validation

Before any input event is sent, the current OS focus and target window
are re-validated against the World Model's current state
(`docs/03-runtime/world-model.md`) — not the state assumed at planning
time. If the user has switched windows or focus has changed since the
target was identified, execution pauses and the step is re-planned
(`docs/03-runtime/planner.md`) rather than sending input to whatever
happens to have focus now. This is the direct mechanism behind the "user
changes window during automation" edge case in
`docs/01-product/use-cases.md`.

## Action granularity

Input is injected in the smallest meaningful increments (a single click,
a single keystroke or short text-entry burst) with a state check between
increments where the target action is part of a longer sequence — this
bounds how much can go wrong before the next verification opportunity,
rather than sending a long, uninterruptible sequence of input events.

## Confirmation requirement

Per `docs/05-ai/hallucination-prevention.md`'s risk-tier framework, any
action at this tier affecting a destructive/irreversible outcome requires
mandatory, multi-step confirmation before the first input event is sent —
there is no exception for this tier, since it is precisely the tier with
the weakest independent safety net if something goes wrong.

## Related documents

- `docs/25-failure-modes/FM-07-tool-execution-and-mcp.md` — failure modes for this subsystem
- `execution-priority.md` — this tier's position as the absolute last
  resort
- `vision.md`, `accessibility.md` — the target-identification mechanisms
  this tier acts upon
- `docs/03-runtime/world-model.md` — the pre-action validation source
- `docs/05-ai/hallucination-prevention.md` — the confirmation requirement
  for destructive actions at this tier
- `docs/06-tools/computer-use-superiority.md` — why this tier's
  pre-action revalidation, combined with the rest of the tier chain, is
  a structural advantage over agents that treat simulated input as their
  primary interface rather than their last resort
- `docs/09-ui/quick-input-surfaces.md` — text expansion's use of this tier's input-injection mechanism, the one case where the lowest tier is the only viable option
- `docs/17-workflow/workflow-recording-and-replay.md` — taps this tier's own action instrumentation as a recording source

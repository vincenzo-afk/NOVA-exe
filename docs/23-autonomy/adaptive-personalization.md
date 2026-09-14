# Adaptive Personalization

## Purpose

Specifies how NOVA becomes "more personalized over time" beyond static
memory retrieval, addressing the gap between v1's memory-only
personalization and continuously adapting behavior — while preserving the
"not fine-tuned on user data" non-goal exactly as written.

## Scope

Policy-level adaptation (routing preferences, tone, proactive timing,
tool defaults) learned from feedback stored as structured memory. This
document explicitly does not cover, and never will cover, model
weight training — that boundary is load-bearing, not incidental.

## What adapts

- **Tool and provider defaults** — e.g., if the user consistently edits
  NOVA's draft emails to be shorter, future drafts default shorter for
  that user, tracked as a structured preference record, not a retrained
  model.
- **Proactive timing** — `docs/23-autonomy/background-life-assistant.md`
  learns, from explicit dismiss/engage feedback, which proactive
  suggestions land well and adjusts frequency/timing accordingly.
- **Routing preferences** — repeated manual overrides of a routing
  policy's default choice (`docs/18-providers/provider-routing.md`) are
  surfaced as a suggested policy change ("you've picked the local model
  over cloud the last 5 times — set this as default?") rather than
  silently changing the policy without the user noticing.
- **Tone and interaction style** — explicit style preferences the user
  states are stored and applied, per the existing memory-based
  personalization pattern already in v1.

## Mechanism

All adaptation is retrieval and policy-rule based over the existing
memory/knowledge-graph substrate (`docs/04-memory/memory-architecture.md`)
and the personal-analytics data feed
(`docs/23-autonomy/personal-analytics.md`) — never a model fine-tune, and
never a hidden weighting the user cannot inspect. Every adaptive
preference is stored as a visible, editable record in
`docs/19-setup/configuration-system.md`'s `personalization` section.

The runtime `AdaptivePersonalization` boundary represents a candidate as a
pending proposal first. Creating a proposal never mutates the active
configuration. An explicit approval is required before the proposal is
written as a `source: "feedback"` record through the shared
`ConfigurationStore`; dismissal removes only the pending proposal. Repeated
routing overrides may create a suggested `routing-preference`, but they
never silently change the active routing policy. Pending proposals can be
listed for inspection, and approved records can be reset individually or
all at once through the existing configuration reset path. Proposal
telemetry contains only bounded identifiers and category metadata; values,
message content, prompts, transcripts, credentials, and model data are not
logged.

## Boundaries (non-negotiable)

- **No model weight changes**, ever, regardless of how much data
  accumulates — restates the v1 non-goal unchanged.
- **No suppression of honest feedback.** Adaptive personalization never
  extends to NOVA softening factual corrections, safety warnings, or
  disagreement to match a user's preferred tone — style adaptation is
  cosmetic, not a filter on substance.
- **No dependency-fostering behavior.** Proactive-timing adaptation
  optimizes for usefulness, not for engagement/session length; there is
  no metric in this system that rewards making NOVA harder to stop using.
- **Fully inspectable and resettable.** The user can view every stored
  adaptive preference and reset any or all of them, returning that
  behavior to its non-adaptive default.

## Related documents

- `docs/25-failure-modes/FM-18-autonomy-policy-approval.md` — failure modes for this subsystem
- `personal-analytics.md` — the data feed this reads
- `docs/04-memory/memory-architecture.md` — the storage substrate
- `docs/00-overview/non-goals.md` — the "not fine-tuned" boundary this
  preserves exactly
- `docs/19-setup/configuration-system.md` — inspection/reset surface
- `docs/23-autonomy/context-aware-suggestions.md` — the event-driven trigger layer whose outcomes feed this document's proactive-timing adaptation

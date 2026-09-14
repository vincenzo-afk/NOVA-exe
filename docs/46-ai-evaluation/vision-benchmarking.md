# Vision Task Benchmarking

## Purpose

Defines how NOVA proves its vision/perception capability is strong
relative to the field, specifically Project Astra, without chasing a
nonexistent public benchmark score — Project Astra is a gated research
prototype with no published scores available, so "beating" it is a
capability comparison, not a leaderboard number
(`docs/references/feature-gap-analysis.md`, row 11).

## Scope

What to measure, how to measure it, and which capability comparisons are
honest versus which would be fabricated. This document does not define
new perception mechanisms — those are `spatial-perception.md`'s
responsibility — it defines how to evaluate them once built, extending
the existing evaluation suite (`docs/46-ai-evaluation/`) rather than
creating a parallel one.

## Why this isn't a leaderboard chase

Claiming a specific numeric win against a system with no public
benchmark would be inventing a comparison NOVA cannot honestly stand
behind. The correct approach is a capability-by-capability comparison
against what Project Astra is actually documented (by Google) to do,
paired with NOVA's own internal test suite so regressions are caught
over time — that is a defensible, honest claim; a fabricated benchmark
score is not.

## Capability comparison table

| Capability | Project Astra | NOVA's path |
|---|---|---|
| Live camera object/scene understanding | Yes, demoed | `spatial-perception.md`'s frame-sequence and `SpatialContext` design |
| Screen understanding | Yes (Gemini Live) | Already available via `ScreenCaptureManager.kt` plus whichever vision-capable provider is routed to |
| Cross-session memory of what it's seen | Yes | `SpatialContext` plus the existing `KnowledgeGraph`/entity-resolution convergence described in `spatial-perception.md` |
| Proactive suggestions from visual context | Yes (outfit-planning demo) | `spatial-perception.md`'s opt-in-gated proactive suggestion channel |
| Runs via a phone companion app | Yes | Android companion app's existing capture surfaces (`VisionCaptureManager.kt`, `ScreenCaptureManager.kt`, `QrAnalyzer.kt`) plus the reasoning loop `spatial-perception.md` adds on top |

## The honest, provable differentiator

Every one of NOVA's capture surfaces — camera, screen — is individually
revocable and auditable through `CompanionPermissionsManager`, with full
test coverage already in place. Project Astra, as a product tied to a
Google account and ecosystem, has no equivalent story described in
available sources. "As capable, but the user can actually see and
control what it's looking at and when" is a real, currently true, and
provable advantage once `spatial-perception.md`'s reasoning layer closes
the raw-capability gap — this claim should be built toward honestly and
not oversold before the underlying capability actually exists.

## Internal test suite additions

Extending the existing evaluation directory (`docs/46-ai-evaluation/`,
which already has `grounding-tests.md`, `hallucination-tests.md`, and
similar test-type documents), vision-specific evaluation adds:

- **Grounding tests for spatial claims** — does an identified object
  match the physical object actually in frame, evaluated against
  labeled test captures, not self-reported model confidence alone.
- **Cross-frame identity persistence tests** — does `SpatialContext`
  correctly resolve "that thing from a second ago" across a sequence of
  frames without incorrectly merging two different objects or splitting
  one object into two records.
- **Proactive suggestion precision/recall** — of suggestions the
  opt-in channel surfaces, what fraction are relevant and non-intrusive
  versus noise, since an agent that suggests too eagerly is a worse
  product than one that says nothing, per the same trust concern
  `spatial-perception.md` raises about unsolicited suggestions.
- **Permission-boundary tests** — confirming a revoked camera/screen
  permission actually and immediately stops capture, not just stops new
  suggestions from that surface; this is the test suite validating the
  actual differentiator claimed above, not just the raw vision
  capability.

## Reporting

Results are tracked the same way other evaluation suites already report
(`docs/46-ai-evaluation/benchmarks.md`) — as an internal, versioned
record over time, so a regression in vision grounding accuracy after a
provider change or a `spatial-perception.md` implementation change is
caught by the suite rather than discovered by a user.

## Related documents

- `docs/references/feature-gap-analysis.md` — the competitive analysis this document implements (row 11)
- `spatial-perception.md` — the capability this document evaluates
- `docs/46-ai-evaluation/grounding-tests.md`, `docs/46-ai-evaluation/hallucination-tests.md` — the existing evaluation-suite conventions this document extends
- `docs/20-devices/android-companion.md` — the companion app whose capture surfaces this document's tests exercise

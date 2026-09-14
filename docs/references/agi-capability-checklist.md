# Capability Checklist: Assistant-Grade Autonomy Beyond the Original Feature List

## Purpose

Tracks a second, broader round of capability requests — modeled loosely
on what Project Astra and similar frontier demos show — against what
this project already specifies versus what needed a new document. Where
`feature-gap-analysis.md` compared NOVA against named competitor
products, this document works from a plain capability list instead and
records, for each item, whether it was already covered, needed a new
document, or was deliberately narrowed or excluded and why.

## Scope

An index and status record, not new design content of its own. Every
"new document" row links to where the actual specification lives; this
file's job is only to make the full list checkable in one place, per
document — not to be authoritative on any capability's actual design.

## Status table

| # | Capability | Status | Where it lives |
|---|---|---|---|
| 1 | Screen understanding + visual cursor guidance | Partially existing (`vision.md` tier 7 for action-taking), extended with new read-only Q&A + pointer overlay | `docs/06-tools/visual-guidance-and-screen-qa.md` |
| 2 | Proactive briefings without a wake word | Already covered, wake-word-free trigger fleshed out this pass | `docs/23-autonomy/background-life-assistant.md` |
| 3 | Domain-specific knowledge bases (codebase/issues/docs) | New | `docs/04-memory/project-knowledge-base.md` |
| 4 | Advanced permission judgment / trust levels | New | `docs/10-security/adaptive-trust.md` |
| 5 | Real-time sensor/IoT integration | New | `docs/20-devices/physical-environment-integration.md` |
| 6 | Computer vision for physical objects | Already covered (built in the prior session) | `docs/20-devices/spatial-perception.md` |
| 7 | Workflow recording and replay | New — distinct from passive skill learning | `docs/17-workflow/workflow-recording-and-replay.md` |
| 8 | Wearable/health vitals integration | New | `docs/20-devices/physical-environment-integration.md` |
| 9 | External live data feeds | New, deliberately narrowed — see below | `docs/20-devices/physical-environment-integration.md` |
| 10 | Self-healing and recovery | Already covered for per-incident recovery; cross-incident pattern detection was a real gap, now closed | `docs/26-system-reference/18-failure-and-recovery-contracts.md`, `docs/26-system-reference/failure-pattern-analysis.md` |
| 11 | Global hotkey command palette | New — the in-app palette existed, the OS-wide trigger didn't | `docs/09-ui/quick-input-surfaces.md` |
| 12 | Text expansion and snippets | New | `docs/09-ui/quick-input-surfaces.md` |
| 13 | App and file launcher | New | `docs/09-ui/quick-input-surfaces.md` |
| 14 | System controls by voice/text | New | `docs/06-tools/os-system-control.md` |
| 15 | Quick note and capture | New | `docs/09-ui/quick-input-surfaces.md` |
| 16 | Media playback controls | New | `docs/06-tools/os-system-control.md` |
| 17 | Universal find-on-page | New | `docs/06-tools/content-interaction-and-narration.md` |
| 18 | Focus mode / do not disturb | New | `docs/23-autonomy/attention-and-communication-management.md` |
| 19 | Quick contact and communication | New | `docs/23-autonomy/attention-and-communication-management.md` |
| 20 | Reading mode and text-to-speech narration | New — spoken *replies* existed, document narration didn't | `docs/06-tools/content-interaction-and-narration.md` |
| 21 | Context-aware proactive suggestions | Adjacent coverage existed (timing adaptation); the event-driven trigger engine itself was a real gap, now closed | `docs/23-autonomy/context-aware-suggestions.md`, `docs/23-autonomy/adaptive-personalization.md` |

## Deliberately narrowed: external data feeds (#9)

The original request for external feeds included satellite imagery,
ship-position tracking, and social-media monitoring. Those are
surveillance/analyst-grade capabilities, not personal-assistant ones,
and were deliberately excluded — weather, traffic, and flight tracking
were kept because each maps to an actual assistant task (commute
planning, trip prep). This follows the same restraint
`feature-gap-analysis.md`'s "what NOVA should not copy" section already
applies elsewhere in this project, not a one-off judgment call specific
to this document.

## Reused infrastructure, not elevenfold duplication

Every "New" row above was written as an *addition* to an existing
mechanism, never a standalone reimplementation: quick input surfaces
reuse the Command Palette's resolver and Entity Resolution; OS/media
control reuses the execution-tier chain; content interaction reuses
TTS and the PDF/extraction skills; attention management reuses the
Observer framework and channel adapters; physical-environment
integration reuses the provider pattern and Knowledge Graph; workflow
recording reuses skill-learning's storage schema; project knowledge
bases reuse the embeddings/retrieval engine; adaptive trust adapts
within, and never around, the existing permission tiers; visual
guidance explicitly preserves vision.md's allow-list restriction rather
than loosening it. None of this list required a new subsystem — the
gap in every case was a missing entry point or a missing extension of
something already built, which is itself evidence of how much of this
was already in place before this pass.

## Related documents

- `feature-gap-analysis.md` — the earlier, competitor-specific capability comparison this document complements
- `docs/00-overview/non-goals.md` — the scope discipline behind every narrowing decision in this document

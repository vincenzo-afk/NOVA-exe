# Persistent User Model: What NOVA Remembers, and Why It's Governed Rather Than Unlimited

## Purpose

Indexes every subsystem that contributes to NOVA "knowing the user" over
time — memory, the Knowledge Graph, entity resolution, personalization,
proactive assistance, and skill learning — as a single answer to "does
NOVA remember everything about me." The honest answer is: NOVA retains a
structured, growing, *governed* model of the user, not an unbounded raw
transcript of everything that ever happened. This document exists so
that claim is never made loosely without pointing at the real lifecycle
rules that make it true and safe.

## Scope

A synthesis and index over already-specified subsystems. This document
does not change memory retention, promotion, or deletion rules — those
remain fully owned by `memory-lifecycle.md`. It does not loosen the
"not fine-tuned or trained on user data" non-goal
(`docs/00-overview/non-goals.md`) — that boundary is restated here, not
revisited.

## Why "remembers everything" is the wrong frame

An agent that stored every raw observation forever would be worse for
the user, not better: retrieval gets slower and noisier, stale or
superseded facts linger and get surfaced as if current, and the privacy
surface grows without bound. `memory-lifecycle.md` exists specifically
to answer "does raw memory grow forever" with "no" — working memory is
discarded or promoted, recent memory is summarized into long-term
memory, and long-term memory itself is subject to garbage collection
(`docs/04-memory/memory-garbage-collection.md`) and confidence decay
(`docs/04-memory/memory-confidence.md`) for anything not recently
corroborated. The right claim is not "remembers everything" — it is
"nothing the user has told or shown NOVA is lost through neglect, but
what's retrieved is curated, current, and confidence-scored," which is
both a stronger and a more honest claim.

## The subsystems that make up the user model

- **Working → Recent → Long-term memory** (`docs/04-memory/memory-architecture.md`,
  `memory-lifecycle.md`) — the base tiered pipeline every observation
  and interaction passes through.
- **Knowledge Graph and entity resolution** (`docs/04-memory/knowledge-graph.md`,
  `docs/04-memory/entity-resolution.md`) — structured facts and
  relationships about people, places, projects, and objects the user has
  mentioned or NOVA has observed, resolved to durable entities rather
  than scattered restatements of the same fact.
- **Spatial entity convergence** (`docs/20-devices/spatial-perception.md`) —
  physical objects identified through the camera resolve into the same
  graph nodes as their text mentions, so "the mug on my desk" and "my
  mug" are one fact, not two.
- **Adaptive personalization** (`docs/23-autonomy/adaptive-personalization.md`) —
  policy-level behavioral adaptation (tone, defaults, proactive timing)
  learned from explicit feedback signals, stored as structured
  preference records — never as retrained model weights.
- **Personal analytics** (`docs/23-autonomy/personal-analytics.md`) —
  aggregated rollups over the user's own observed activity, derived from
  data already captured elsewhere, not a separate tracking system.
- **Background/proactive assistance** (`docs/23-autonomy/background-life-assistant.md`) —
  uses the user model to prepare relevant context ahead of an explicit
  request, scheduled like any other job, not an always-on surveillance
  process.
- **Skill learning** (`docs/23-autonomy/skill-learning.md`) — the
  procedural counterpart to the factual user model above: what NOVA has
  learned it can *do* for this user, as opposed to what it knows *about*
  them, gated on verified success and never bypassing permissions.

Each of these already has its own full specification; this document's
only job is to name them together as one coherent answer to "what does
NOVA remember," so a future reader doesn't have to reconstruct that
picture from eleven separate files.

## The boundary that never moves

**Nothing above trains or fine-tunes a model on user data.**
`docs/00-overview/non-goals.md` states this exclusion explicitly and it
remains fully intact regardless of how much this user model grows in
scope: personalization, analytics, proactive assistance, and skill
learning are all built as **structured records retrieved at inference
time**, never as weight updates. This is a load-bearing architectural
choice, not an incidental detail — it is what keeps the user model
inspectable, correctable, and deletable in a way a fine-tuned model's
learned behavior could never be.

## Correctability and deletion

Because every layer of this model is a structured record rather than an
opaque learned weight, every layer is independently inspectable and
deletable by the user through the same mechanisms already specified for
each subsystem (the Memory screen, `docs/40-screens/memory-screen.md`;
Knowledge Graph node inactivation/merge history,
`docs/04-memory/knowledge-graph.md`; a demoted-not-deleted skill,
`skill-learning.md`). A wrong fact, a bad personalization signal, or a
mistakenly learned skill is always something the user can see and remove
— not something baked irretrievably into model behavior.

## Related documents

- `docs/00-overview/non-goals.md` — the "not fine-tuned on user data" boundary this document restates
- `docs/04-memory/memory-architecture.md`, `docs/04-memory/memory-lifecycle.md` — the governed tiered pipeline underlying everything in this document
- `docs/04-memory/knowledge-graph.md`, `docs/04-memory/entity-resolution.md` — structured facts and relationships
- `docs/20-devices/spatial-perception.md` — physical-world entity convergence into the same graph
- `docs/23-autonomy/adaptive-personalization.md`, `docs/23-autonomy/personal-analytics.md`, `docs/23-autonomy/background-life-assistant.md` — behavioral and proactive layers
- `docs/23-autonomy/skill-learning.md` — the procedural counterpart to this document's factual user model
- `docs/40-screens/memory-screen.md` — where the user inspects and corrects this model directly

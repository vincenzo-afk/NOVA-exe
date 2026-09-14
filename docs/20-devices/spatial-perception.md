# Spatial Perception

## Purpose

Specifies physical-world, camera-based spatial understanding through the
Android companion app — what is this thing the camera is pointed at, and
where is it relative to the user — as the direct answer to the
vision-perception gap identified against Project Astra
(`docs/references/feature-gap-analysis.md`, row 3).

## Scope — and the boundary that must never blur

This document is **physical-space only**. `docs/03-runtime/world-model.md`
already uses the word "spatial" for something entirely different — desktop
window z-order and monitor/virtual-desktop placement — and explicitly
scopes itself that way. The two must never be conflated: a query about
"what's on my screen right now" is the World Model's domain; a query
about "what am I looking at through the camera" is this document's
domain. Treating them as the same concept because they share a word is
exactly the kind of ambiguity that produces real bugs, and this boundary
is stated explicitly for that reason.

## Capture surfaces (already built)

The Android companion app already has the raw capture surfaces this
document reasons over:

- `VisionCaptureManager.kt` — still-image camera capture.
- `ScreenCaptureManager.kt` — screen capture (phone screen, not camera).
- `QrAnalyzer.kt` — QR/barcode-specific analysis.
- `CompanionPermissionsManager` — per-surface, revocable, audited
  permission grants for camera and screen capture individually.

What none of these currently have is a reasoning layer: each captures
raw bytes and hands them to whichever vision-capable provider is
configured, with zero spatial reasoning or cross-frame memory happening
in NOVA's own code. This document specifies that layer.

## Frame sequence continuity: SpatialContext

`VisionCaptureManager` today captures single stills with no memory
between calls — every frame is independent. This document adds a
session-scoped `SpatialContext` that tracks which entities (objects,
documents, and people, where consented) were identified across the last
N frames, so a reference like "that thing I showed you a second ago"
resolves against recent context instead of requiring the full frame
history to be re-sent to the model on every turn. This is a real
latency and cost optimization as much as a capability — re-sending
accumulated frames on every turn scales badly — and it mirrors a
problem NOVA has already solved once: `docs/04-memory/entity-resolution.md`
already runs an exact-match → high-confidence-match → ambiguous →
new-entity pipeline for text mentions. `SpatialContext` is the vision
analog of that same pipeline, applied to detected objects instead of
text spans.

## Convergence with the Knowledge Graph

`SpatialContext`'s object matches resolve into the same
`docs/04-memory/knowledge-graph.md` nodes the text-mention resolver
already writes to — deliberately, not incidentally. "The mug on my
desk," identified via camera, and "my mug," mentioned later in chat,
should converge on the same graph node rather than producing two
disconnected records of the same real-world object. This is what makes
spatial perception a genuine extension of NOVA's existing memory
architecture rather than a parallel, disconnected subsystem — the same
positioning `docs/references/feature-gap-analysis.md` calls out as more
rigorous than what is publicly described for Project Astra.

## Confidence and staleness

Object identifications inherit the same confidence model as the rest of
memory (`docs/04-memory/memory-confidence.md`): a match not recently
corroborated by a fresh frame decays in confidence rather than being
treated as permanently true, since physical objects move, get put away,
or get replaced in ways a desktop window's state does not. `SpatialContext`
is explicitly a **bounded, sliding window**, not an accumulating log —
matching the same non-growing-buffer pattern `world-model.md` uses for
its own short rolling state window, for the same reason: recent physical
context needs to be cheap to query without becoming an unbounded store.

## Proactive assistance

Project Astra's headline "plans an outfit without being asked" behavior
requires an agent that offers, not just responds. NOVA's Observer
framework (`docs/07-observers/`) already has the metadata-vs-content
distinction needed to do this responsibly — metadata-only observation by
default, without invasive raw content capture. This document extends
that pattern with a **proactive suggestion channel**: the Planner may
populate a suggestion from spatial context, but every suggestion category
requires an explicit, per-category user opt-in and is never default-on.
Project Astra itself is still described as a gated research prototype;
unsolicited camera-driven suggestions are exactly the kind of feature
that erodes trust quickly if it is ever wrong or feels invasive, so the
existing per-capability permission discipline
(`docs/10-security/permissions.md`) is the guard here, not a reason to
withhold the feature entirely.

## Real-time (video) vs. still capture

Project Astra's comparison point is live audio+video, not single stills.
`SpatialContext`'s frame-sequence design is built to extend from
periodic stills (the current capture mechanism) to a continuous video
stream without a redesign — the entity-matching pipeline operates
per-frame regardless of capture cadence — but continuous capture is a
materially larger resource, bandwidth, and privacy surface than
still capture, and is explicitly gated behind its own permission tier
and resource budget (`docs/11-performance/resource-usage.md`), separate
from and stricter than the still-capture permission already granted by
`CompanionPermissionsManager`.

## Implementation

`services/runtime/src/spatial-context.ts` (`SpatialContext`) implements
the pipeline above: a bounded, decaying sliding window for cross-frame
continuity, falling through to `entity-resolution.ts`'s unmodified
`EntityResolver` — against a new `"PhysicalObject"` node type added to
`knowledge-graph.ts`'s ontology — for anything the window can't answer.
`services/runtime/src/vision-pipeline.ts` wraps it with frame validation
and an injected `VisionProvider`, and `companion-server.ts` exposes the
whole thing over `/v1/companion/vision/frame`, fed by
`VisionCaptureManager.kt`/`ScreenCaptureManager.kt`'s already-real
capture surfaces via the new `VisionPipelineClient.kt`. Depth/3D
reconstruction remains out of scope, per this document's boundary
above — nothing in this implementation attempts it.

## What this document does not cover

- Depth sensing or 3D reconstruction from camera hardware — out of scope
  unless and until companion devices expose depth sensors; today's
  spatial reasoning is 2D-frame object/scene identification plus
  relative-position inference from framing, not true 3D geometry.
- Desktop window spatial state — that remains `world-model.md`'s domain
  entirely, per the scope boundary above.

## Related documents

- `docs/references/feature-gap-analysis.md` — the competitive analysis this document implements (row 3)
- `docs/03-runtime/world-model.md` — the deliberately distinct desktop-spatial concept this document must never be conflated with
- `docs/04-memory/entity-resolution.md` — the text-mention matching pipeline this document's object matching mirrors
- `docs/04-memory/knowledge-graph.md`, `docs/04-memory/memory-confidence.md` — where spatial entity matches are stored and scored
- `docs/07-observers/` — the metadata-first observation pattern the proactive-suggestion channel extends
- `docs/10-security/permissions.md` — the opt-in gate for proactive suggestions and continuous capture
- `android-companion.md` — the companion app this document's capture surfaces belong to

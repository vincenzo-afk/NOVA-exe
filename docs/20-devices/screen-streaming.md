# Screen Streaming From Phone

## Purpose

Specifies the pipeline that lets NOVA see and understand what's on a
paired phone's screen: Phone → Vision → NOVA understands phone, as a
concrete instance of "vision everywhere"
(`docs/18-providers/provider-interface.md`).

## Scope

The streaming and frame-processing pipeline. Camera capture (pointing the
phone at the world) is covered in `android-companion.md`'s Vision
section; this document is specifically about capturing the phone's own
display.

## Pipeline

1. **Capture** — the Android companion app captures screen frames via
   Android's MediaProjection API, only after an explicit, per-session
   user grant (Android requires this prompt natively; NOVA cannot and
   does not bypass it).
2. **Transport** — frames stream to the Primary Runtime over the same
   paired-device transport as other companion traffic
   (`multi-device-architecture.md`, typically Tailscale-tunneled), at a
   reduced frame rate and resolution tuned for understanding rather than
   video quality — this is not a screen-mirroring product.
3. **Understanding** — frames are routed through the Vision capability
   (`docs/18-providers/provider-interface.md`) the same way desktop
   screen understanding is (`docs/06-tools/vision.md`), so the Planner
   uses one vision pipeline regardless of which device the frame came
   from.
4. **Action** — if the Planner decides an action is needed on the phone
   (e.g., "tap this notification"), it is issued back to the companion
   app as an Accessibility-Service or Intent action per
   `android-companion.md`'s App control section — vision on the phone and
   action on the phone are two separate, explicit steps, not implicit.

## Session model

Screen streaming is session-scoped, not always-on: it starts when the
user asks NOVA to look at the phone (or a task explicitly requires it)
and ends when the task completes or after a configurable idle timeout.
This mirrors the existing tiering in `docs/06-tools/vision.md`, where
vision/GUI capabilities are treated as an explicit, bounded tier rather
than continuous background surveillance.

## Data handling

Streamed frames are processed and, unless the active vision provider's
routing policy is cloud, never leave the paired-device pair. Frames are
not persisted to long-term memory by default — only derived, structured
observations (e.g., "a calendar invite notification from X was visible")
are eligible for memory storage, following the existing raw-vs-derived
data lifecycle in `docs/04-memory/memory-lifecycle.md`.

## Related documents

- `docs/25-failure-modes/FM-10-desktop-android-distributed-sync.md` — failure modes for this subsystem
- `android-companion.md` — the app this pipeline runs inside
- `docs/06-tools/vision.md` — the desktop-side vision tiering this
  extends
- `docs/18-providers/provider-interface.md` — shared Vision domain
  interface
- `docs/20-devices/physical-environment-integration.md` — the provider-pattern integration for the companion phone's surrounding physical environment, distinct from this document's phone-screen-specific pipeline

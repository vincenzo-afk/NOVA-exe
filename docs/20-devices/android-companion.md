# Android Companion

## Purpose

Specifies the Android client that lets NOVA use the phone: read
notifications, access files, control supported apps, and act as a
capture surface for voice and vision, per
`docs/15-decisions/adr-0008-v5-architecture-evolution.md`.

## Scope

The companion app's capabilities and permission model. It runs in
Companion mode as defined in `multi-device-architecture.md` — it is a
capture/render surface talking to a Primary Runtime, not an independent
Planner.

## Capabilities

- **Notification access** — with Android's Notification Listener
  permission, incoming notifications are structured and made available
  to the Primary Runtime as an observer source, following the same
  observer-framework pattern as `docs/07-observers/notifications.md`
  (desktop) — this is the same interface, a new capture source.
- **App control** — supported apps are driven through Android's
  Accessibility Service (the mobile equivalent of the desktop
  `docs/06-tools/accessibility.md` tier) or through app-specific Android
  Intents/deep links where available, in that priority order — direct
  Intents are preferred over Accessibility-Service simulation wherever an
  app exposes them, mirroring the desktop execution-priority principle
  (`docs/06-tools/execution-priority.md`).
- **File access** — Storage Access Framework-scoped access to
  user-granted folders; never blanket filesystem access.
- **Vision** — camera and screen-content capture feed the Vision
  capability domain (`docs/18-providers/provider-interface.md`),
  routed to whichever provider (on-device or cloud) is configured,
  enabling "point the phone camera and ask NOVA" interactions.
- **Voice** — local wake-word detection with STT/TTS routed per
  `docs/22-voice/voice-assistant.md`; can run fully on-device for
  privacy-first routing policy or hybrid with the Primary Runtime for
  heavier reasoning.

## Screen streaming

When the user asks NOVA to "look at my phone," the companion app streams
screen frames to the Primary Runtime's Vision capability
(`docs/20-devices/screen-streaming.md`), which is the phone-specific
instance of "vision everywhere"
(`docs/18-providers/provider-interface.md` domain table).

## Permission model

Every capability above requires its corresponding Android runtime
permission, requested individually and revocable at any time from Android
Settings — NOVA never requests a bundled "allow everything" grant. Losing
a permission degrades only the dependent capability (e.g., revoking
Notification Listener stops notification capture without affecting app
control), consistent with the Capability Registry's graceful-degradation
model (`docs/18-providers/capability-management.md`).

## Background operation

The companion runs a foreground service with a persistent, user-visible
notification whenever always-listening voice or background notification
capture is active, per Android platform requirements and NOVA's own
transparency principle (`docs/00-overview/design-principles.md`) — there
is no hidden background listening mode.

## Related documents

- `docs/25-failure-modes/FM-10-desktop-android-distributed-sync.md` — failure modes for this subsystem
- `multi-device-architecture.md` — how this device pairs and syncs
- `screen-streaming.md` — phone screen as a vision source
- `docs/22-voice/voice-assistant.md` — voice capture and response
- `docs/20-devices/ai-phone.md` — the longer-term "phone as primary
  device" extension of this companion
- `docs/20-devices/spatial-perception.md` — the physical-world reasoning
  layer built on top of this document's camera and screen capture
  surfaces

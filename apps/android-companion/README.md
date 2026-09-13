# NOVA Android Companion

Kotlin/Jetpack Compose/Gradle client per `docs/00-implementation-governance/technology-lock.md`
and scoped by `docs/20-devices/android-companion.md`. Added to close the
gap noted in `AUDIT_REPORT.md`: the locked tech stack and `IMPLEMENTATION_PLAN.md`
M12 both name this app, but no Android project previously existed —
only the Primary-Runtime-side `AndroidCompanionManager` contract in
`services/runtime/src/android-companion.ts`.

## What's here

- `CompanionPermissionsManager` — Kotlin port of `android-companion.ts`'s
  permission/capability state machine (individually revocable, no bundled
  grant, per-capability `use()` gating, foreground-service-gated
  background use), with parity unit tests.
- `PairingManager` — QR payload parsing and the non-optional
  challenge/response signature verification required by
  `docs/28-multi-device-protocol/02-device-pairing-protocol.md` and its
  FM-26-006 failure mode ("skipping the signature verification step"),
  using the platform's built-in EC/secp256r1 signature support.
- `CompanionForegroundService` — the persistent, user-visible
  notification required whenever background capture is active.
- `NotificationCaptureService` — a `NotificationListenerService` that
  normalizes platform events to metadata only, mirroring the desktop
  notification observer's metadata/content split.
- `PairingScreen` / `PermissionsScreen` — minimal Compose UI wiring the
  above.

## What's intentionally not here yet

- The actual local-network/mesh transport that carries the pairing
  challenge/response and ongoing sync
  (`docs/28-multi-device-protocol/05-networking-and-discovery.md`) —
  `PairingManager` verifies a signature it's given; sending the
  challenge and receiving the desktop's response over the wire is a
  separate integration. The connection lifecycle state machine this
  transport would drive (Disconnected → Discovering → Pairing/
  Authenticating → Connected → Healthy⇄Degraded → Reconnecting) is now
  implemented on the runtime side —
  `services/runtime/src/device-connection-lifecycle.ts` — with mDNS/
  mesh-provider I/O left as injected collaborators; only the actual
  network calls remain unwired.
- CameraX QR scanning is declared as a dependency and the manifest
  requests `CAMERA`. **Done** — see `QrAnalyzer.kt` (ML Kit
  `ImageAnalysis.Analyzer`, QR-only, dedupes repeat scans of the same
  value) and `ui/CameraQrScanner.kt` (CameraX preview binding,
  requests `CAMERA` at point of use rather than on launch);
  `PairingScreen` now defaults to the live camera scan with a
  manual-paste fallback. Not unit-testable at the JVM level — it
  depends on real Android Camera/ML Kit runtime types, so it needs an
  instrumented test, not covered by this session's `vitest`-style unit
  tests.
- App Control (Accessibility Service / Intents), File Access (SAF), and
  Vision (still-image capture) now have platform-side implementations —
  `AppController.kt`/`NovaAccessibilityService.kt` (Intent-first,
  Accessibility-Service fallback, priority order per the doc),
  `FileAccessManager.kt` (SAF-scoped, no path accepts a raw filesystem
  path), `VisionCaptureManager.kt` (CameraX still capture, returns raw
  JPEG bytes for the provider layer to route). All three call through
  `CompanionPermissionsManager.use()` before doing anything, same as
  every other capability. **Not covered by unit tests** — all three
  depend on real Android framework types (`AccessibilityNodeInfo`,
  `Intent`, `Context`, CameraX/SAF APIs) that aren't constructible in a
  plain JVM test without Robolectric, which isn't a dependency here and
  couldn't be added without network access. Real coverage needs either
  Robolectric or instrumented (on-device) tests — stated here rather
  than skipped silently or faked with a test that doesn't actually
  exercise the Android APIs.
- Screen-content capture (the other half of Vision, per
  `docs/20-devices/screen-streaming.md`) — **done**. See
  `ScreenCaptureManager.kt`: MediaProjection-based, session-scoped
  (explicit start, idle-timeout auto-stop, no always-on path),
  downscaled/throttled JPEG frames rather than full video, same Vision
  capability gate as the still-image capture. Requires
  `CompanionForegroundService` to already be running with the
  `mediaProjection` foreground-service type before a session starts —
  Android 14+ enforces this ordering itself. Not unit-tested, same
  reasoning as every other Android capability class this session:
  depends on real `MediaProjection`/`ImageReader`/`Bitmap` types.
- The App Control Accessibility Service currently has no `<queries>`
  manifest declaration for specific target packages (Android 11+
  package visibility) — deliberately left unnamed since which apps
  NOVA should control is a product decision, not something to guess at
  in this pass.

## Build status

This sandbox has no network access and no Android SDK/toolchain
installed, so `./gradlew build` has **not** been run against this
project — the same limitation noted in `AUDIT_REPORT.md` for the rest
of the repository, which also could not be built or tested here.
Dependency versions were chosen to be current and mutually compatible
as of early 2026, but that has not been verified by an actual build.
note: gradle-wrapper.jar itself is a binary fetched by 'gradle wrapper' and isn't included — no network access to generate/verify it here.

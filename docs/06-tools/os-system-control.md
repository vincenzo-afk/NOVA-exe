# OS-Level System and Media Control

## Purpose

Extends NOVA's control surface one level below individual applications:
volume, brightness, network toggles, display mode, and media playback
transport controls — the operating system's own settings and the
system media-session API, not any one app's UI. This closes a real gap:
`docs/06-tools/automation.md` and `docs/06-tools/desktop-agent.md`
control applications; nothing currently specifies control of the OS
itself or of whichever app currently holds the system media session.

## Scope

Two related but distinct control surfaces, grouped because both route
through the same execution-tier discipline
(`docs/06-tools/execution-priority.md`) and the same low-risk-tier
permission class, not because they're technically the same mechanism.

## System settings control

"Set volume to 50%," "mute speakers," "increase brightness," "turn on
WiFi," "enable Bluetooth," "switch to dark mode," "show battery status."
Each of these has a real platform API (Core Audio / AudioManager,
display brightness APIs, network toggles, appearance mode) reachable at
the **Internal Functions or Native Runtime tier**
(`docs/06-tools/execution-priority.md`'s top tiers) — this is
deterministic, verifiable OS control, never routed through the Vision
or Keyboard/Mouse fallback tiers that exist for arbitrary third-party
application UIs. A settings request that has no direct platform API on
a given OS (rare, since these are standard OS surfaces) falls back
through the tier chain like any other action would.

Every setting change is classified at the **low risk tier**
(`docs/10-security/permissions.md`) — reversible, non-destructive,
immediately visible to the user, auto-approved by default the same way
other low-risk actions already are — with the single exception of
network toggles (enabling/disabling WiFi or Bluetooth), which are
**medium tier**, since disabling connectivity mid-task can strand an
in-progress action in a way volume or brightness changes cannot.

## Media playback control

"Play Spotify," "pause music," "next track," "play lofi playlist,"
"search for 'blues' on YouTube Music." Two distinct mechanisms,
selected by what's actually available for the target, per
`execution-priority.md`'s preference ordering:

1. **System media-session API** (preferred) — the OS's own now-playing/
   transport-control surface (macOS's Now Playing, Windows's System
   Media Transport Controls, Android's MediaSession), which works
   uniformly across whatever app currently holds the media session
   without needing per-app integration. This is the deterministic,
   verifiable path and is used whenever the target action (play/pause/
   skip/volume) is expressible through it.
2. **App automation fallback** — for an action the system media session
   can't express (searching a specific service's catalog, selecting a
   named playlist), NOVA falls through to that specific app's existing
   automation tier per `docs/06-tools/automation.md`/`execution-priority.md`,
   exactly as any other app-specific action would.

NOVA does not maintain its own list of "supported" media apps beyond
what the OS media-session API and each app's own automation surface
already provide — adding support for a new player is a consequence of
that player implementing the platform's media-session API correctly,
not a NOVA-side integration project.

## Voice and text parity

Every control in this document is reachable identically through typed
text, the Command Palette / global hotkey bar
(`docs/09-ui/quick-input-surfaces.md`), and voice
(`docs/22-voice/voice-assistant.md`) — there is no voice-only or
text-only subset. This matters specifically for this feature set
because "set volume to 50%" and "next track" are exactly the kind of
short, imperative commands a user reaches for by voice while doing
something else, so parity here is a real usability requirement, not
just architectural tidiness.

## Related documents

- `docs/06-tools/execution-priority.md` — the tier ordering system controls and media control both route through
- `docs/06-tools/automation.md` — the app-automation fallback for media actions with no system media-session equivalent
- `docs/06-tools/computer-use-superiority.md` — the broader argument this document is one concrete instance of
- `docs/10-security/permissions.md` — risk-tier classification for settings changes
- `docs/09-ui/quick-input-surfaces.md`, `docs/22-voice/voice-assistant.md` — the entry points this document's controls are reachable from

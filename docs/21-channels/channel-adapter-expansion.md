# Channel Adapter Expansion

## Purpose

Expands NOVA's messaging platform reach from the current three adapters
(Telegram, Discord, WhatsApp) toward parity with the field — OpenClaw
reaches 50+ platforms, Hermes Agent 16+ — by implementing additional
`ChannelAdapter`s against the existing, already-proven interface
(`docs/references/feature-gap-analysis.md`, row 10). This is the lowest-
engineering-risk item in the competitive gap analysis: no new
architecture is required, only more implementations of an interface that
already works.

## Scope

Which adapters to build and in what order, and the constraints specific
to each new platform. The `ChannelAdapter` interface itself, and its
capability-negotiation `describe()` pattern, is unchanged and fully
specified in `messaging-platforms.md` — this document does not modify
that interface, it exercises it.

## Why the existing interface doesn't need to change

`messaging-platforms.md` already documents a clean "Adding a new
platform" process built around an explicit `describe()` capability-
negotiation method — a platform's real constraints (for example
WhatsApp's 24-hour messaging-window rule) surface to the Planner as an
actual limit rather than a silent failure. Every adapter below plugs
into that same pattern; a new adapter is additive work, not a change to
shared infrastructure.

## Priority order and rationale

1. **Slack** — highest reach-per-effort in professional/team contexts,
   stable and well-documented API, directly comparable to Discord's
   integration shape already proven.
2. **Email (SMTP/IMAP)** — arguably higher value than any single chat
   platform because it is universal and not gated behind any one
   company's ecosystem; NOVA already has email-assistant logic
   (`email-assistant.md`) this adapter connects to as a first-class
   channel rather than a separate subsystem.
3. **Signal** — the standout privacy-respecting messaging platform; a
   natural fit given NOVA's existing security/permission posture, though
   its API surface is the most constrained of this list and should be
   scoped conservatively (text messaging first, no assumption of rich
   media or group features matching Telegram/Discord).
4. **iMessage** — macOS-only, but high value for NOVA's desktop-first
   user base on that platform; explicitly platform-gated in its
   `describe()` response so the Planner never assumes availability on
   non-macOS installs.
5. **Matrix** — federated, open protocol; lower individual-user demand
   than the above but valuable for self-hosted/privacy-conscious
   deployments consistent with NOVA's broader security stance.

This order is reach-and-stability weighted, not effort-weighted — a
platform higher on this list is not necessarily easier to implement, it
is judged more valuable to implement first.

## Per-adapter constraints to declare via describe()

Each new adapter must declare, at minimum, through the same `describe()`
mechanism existing adapters use:

- **Messaging window / rate constraints** — e.g., Slack's rate limits,
  any equivalent of WhatsApp's 24-hour window if applicable.
- **Supported content types** — text, rich media, threading, reactions —
  so the Planner never attempts an unsupported action and silently fails.
- **Group vs. direct-message semantics** — where a platform's model
  differs meaningfully from the three existing adapters (Signal's group
  model in particular differs from Discord's).
- **Authentication/session model** — bot-token-based (Slack, Discord-style)
  versus user-session-based (iMessage, Signal) — this affects which
  permission tier a given adapter's actions fall under
  (`docs/10-security/permissions.md`), since acting through a user's own
  authenticated session carries different risk than acting as a
  separately-authenticated bot identity.

## Testing requirement

Each new adapter ships with the same conformance test suite pattern
already required for existing adapters (`docs/12-testing/`) validating
its `describe()` output against actual platform behavior — a
`describe()` response that overclaims capability is worse than one that
underclaims it, since the Planner trusts it directly.

## Related documents

- `docs/references/feature-gap-analysis.md` — the competitive analysis this document implements (row 10)
- `messaging-platforms.md` — the unchanged `ChannelAdapter` interface and capability-negotiation pattern this document exercises
- `email-assistant.md` — the existing email logic the SMTP/IMAP adapter connects to as a first-class channel
- `docs/10-security/permissions.md` — the permission-tier distinction between bot-token and user-session adapters
- `docs/12-testing/` — the conformance testing pattern each new adapter must follow

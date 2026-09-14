# Permissions

## Purpose

The authoritative policy definition for risk-tiered execution: which risk
tiers require which confirmation level, and the separate, per-source
observation permission model — the policy layer that
`docs/03-runtime/permission-manager.md` enforces mechanically at runtime.

## Scope

Policy definition for both execution risk tiers and observation
permissions. Runtime enforcement mechanics are
`docs/03-runtime/permission-manager.md`; AI-specific gating nuance is
`docs/05-ai/hallucination-prevention.md`.

## Execution risk tiers and confirmation policy

| Risk tier                | Definition                               | Default confirmation requirement                                                                  |
| ------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Read-only                | No state change                          | None — executes immediately                                                                       |
| Reversible-write         | Changes state, but an undo path exists   | Configurable; off by default for low-consequence actions, but always logged with undo information |
| Destructive/irreversible | Changes state with no reliable undo path | Mandatory, explicit confirmation — no exceptions, no user-configurable override to disable        |

The destructive/irreversible tier's mandatory confirmation cannot be
disabled by user configuration, even for a user who wants maximum
autonomy — this is a deliberate, firm boundary rather than a default that
convenience settings can erode over time.

## Observation permission model

Distinct from execution risk tiers, observation permissions are granted
per source (`docs/07-observers/observer-framework.md`), off by default,
and — for Clipboard and Notifications specifically — at two separate
granularity levels (metadata-only vs. content capture, per
`docs/07-observers/clipboard.md` and `docs/07-observers/notifications.md`).
Filesystem observation is additionally scoped per folder, not
filesystem-wide (`docs/07-observers/filesystem.md`). Clipboard observation
uses two separate source grants: `clipboard_metadata` starts only metadata
observation, while `clipboard_content` independently permits eligible text
content; content permission never overrides sensitive-source exclusion.
Notifications use `notifications_metadata` for source/title/timestamp metadata
and `notifications_content` for eligible body text; the latter never replaces
the former and cannot override messaging/authentication-source exclusion.
Browser metadata uses the separate off-by-default `browser_metadata` grant and
is limited to visible extension-reported tab open/close/activation/navigation
metadata, normalized HTTP(S) domain/path URLs, and bounded titles. It never
captures page content, form fields, entered text, passwords, payments, DOM
state, or browser automation. `permissions.browser_excluded_domains` is a
validated local hostname/wildcard list applied before browser events are
published or indexed; revocation stops the bridge and purges pending browser
metadata. Keyboard activity uses a separate off-by-default `keyboard_activity`
grant and is limited to active/idle signals plus explicitly registered hotkey
identity events. It never captures, stores, or logs actual keystroke content;
registered combinations are configuration metadata used only by the native
hotkey matcher, and emitted events contain only the configured hotkey ID.
Mouse activity uses a separate off-by-default `mouse_activity` grant and is
limited to active/idle transitions. An authorized action-time position read is
performed only on demand and returns bounded coordinates; the system never
records continuous movement, click history, button state, or cursor trails.

Screen capture and structured desktop control are separate, explicit source categories defined
by `docs/06-tools/desktop-agent.md`: `screen` permits only one-shot,
task-bound screenshots, while `desktop_control` permits only focus-checked
Windows UI Automation actions. Both are off by default, revocable immediately,
and do not start background observation. Clipboard metadata is also off by
default; revoking it stops the event listener and purges pending clipboard
events, while revoking clipboard content immediately downgrades subsequent
events to metadata-only. Revoking notification metadata stops the native
UI Automation listener and purges pending notification events; revoking
notification content immediately downgrades later events to metadata-only.

## Path containment enforcement

Any component checking a path against a granted folder scope (the
Filesystem Observer above, and any tool/action that reads or writes a
file at a model- or plugin-supplied path) resolves the path to its
canonical, absolute form (resolving `.`, `..`, and symlinks) before
checking containment — never comparing the raw, unresolved string
against the granted folder path. A path containing `../` segments, or a
symlink pointing outside the granted folder, is rejected as
out-of-scope, not silently followed. This is a hard requirement, not an
implementation detail left implicit: a path-scope check performed on an
unresolved string is not a real containment check and must not be
treated as satisfying this permission model.

## The permission center

All permission grants — observation sources, execution confirmation
preferences within the configurable reversible-write tier, and provider/
MCP connection approvals — are managed through one consolidated
permission center UI, reachable from every surface
(`docs/09-ui/ui-overview.md`), not scattered across separate,
hard-to-find settings screens.

## Revocation

Any granted permission can be revoked at any time, taking effect
immediately — a revoked observation source stops capturing immediately
(`docs/07-observers/observer-framework.md`) and a revoked execution
confirmation preference reverts that action category to requiring
confirmation on the very next relevant task, not merely for future
configuration changes.

## Why destructive-tier confirmation has no override

Per this project's foundational review, unconfirmed destructive action —
under any circumstance — was identified as a hard requirement, not a
default. Allowing a configuration override would mean the system's
strongest safety guarantee is only as strong as the least careful user's
settings, which defeats its purpose as a guarantee at all.

## Related documents

- `docs/25-failure-modes/FM-12-security-sandbox-identity.md` — failure modes for this subsystem
- `docs/03-runtime/permission-manager.md` — runtime enforcement of this
  policy
- `docs/05-ai/hallucination-prevention.md` — the AI-specific extension of
  this tiering
- `docs/07-observers/` — the per-source observer permissions referenced above
- `docs/06-tools/desktop-agent.md` — task-bound screen and desktop-control permissions
- `docs/23-autonomy/skill-learning.md` — a learned skill re-requests every
  permission it needs through this tiering at reuse time; it never
  inherits or bypasses a grant by having been learned
- `docs/16-extensibility/execution-backends.md` — backend selection
  (local vs. containerized execution) is itself a risk-tier decision
  routed through this document's confirmation flow
- `docs/06-tools/authenticated-session-audit.md` — per-domain,
  risk-tiered confirmation for actions taken inside the user's own
  authenticated browser sessions
- `docs/10-security/adaptive-trust.md` — the learned confirmation-frequency layer that adapts within these tiers without ever changing them

# Adaptive Trust: Learning Confirmation Preferences Within Fixed Risk Tiers

## Purpose

Lets NOVA's confirmation behavior get less naggy over time for a
specific user's actual approval patterns, without ever changing what
counts as risky. `permissions.md` already specifies fixed execution
risk tiers and a confirmation policy per tier; what it doesn't specify
is any adaptation to the fact that one user reliably approves a given
repeated, narrow action while another never does. This closes that gap.

## Scope

A per-user, per-action-type approval-frequency signal that adjusts
*which confirmation UI is shown by default* within the bounds
`permissions.md` already sets — never a mechanism that changes which
tier an action belongs to, and never a path to bypassing the tier
`permissions.md` assigns.

## The one rule this document cannot override

**Destructive-tier actions always require confirmation, with no
adaptive override, ever.** `permissions.md`'s "Why destructive-tier
confirmation has no override" section already states the reasoning;
this document does not reopen that decision. Everything below applies
only to tiers `permissions.md` already treats as eligible for
faster-path handling (low and, in a narrower form, medium).

## What actually adapts

For a **specific, narrowly-scoped action type** — not "file access"
broadly, but something as specific as "read files under
`~/projects/nova`" — NOVA tracks a simple approval-frequency count: how
many times this exact scope was explicitly approved versus denied.
Once that count crosses a threshold with no intervening denial, the
**low-tier** confirmation UI for that specific scope changes from a
blocking prompt to a lightweight, dismissible notification the action
already proceeded under — still visible, still logged, still revocable,
just no longer blocking. This is within the low tier's own defined
behavior space (already eligible for lighter treatment under
`permissions.md`), not a new tier and not a promotion out of the low
tier's own rules.

**Medium-tier actions never silently drop to notification-only.** The
most adaptation allowed at medium tier is a shortened prompt (skipping
re-explaining a scope the user has approved many times before) — the
confirmation step itself is never removed, per `permissions.md`'s
tiering intent that medium-risk actions remain a deliberate, visible
decision each time.

A single denial resets the count for that specific scope to zero and
immediately reverts to full blocking confirmation — trust here is a
signal that decays completely on any negative evidence, not a slowly
eroding average. This mirrors `docs/23-autonomy/skill-learning.md`'s
own asymmetric decay principle (a failure counts for more than a
success) for the same underlying reason: a false sense of established
trust is worse than an occasional redundant prompt.

## Per-scope, not global

Trust is tracked per narrow scope, never generalized across scopes or
tools — approving `~/projects/nova` file reads many times does not
adjust confirmation behavior for `~/projects/other-client` file reads,
or for any other tool entirely. This is the same non-generalization
principle `permissions.md`'s tiering already implies (a risk tier is
assigned per action type, not inferred by analogy) applied to the
adaptive layer specifically, so learned trust can never quietly spread
beyond the exact scope that earned it.

## Storage and visibility

Approval-frequency counts are stored as structured, inspectable records
(`docs/04-memory/persistent-user-model.md`'s "structured, never opaque"
principle) — visible and individually resettable in the Permission
Center (`permissions.md`'s existing permission center UI), not a hidden
signal accumulating invisibly. A user can see exactly which scopes have
accumulated trust, and reset any one of them back to full confirmation
at any time, with the same one-click revocation `permissions.md`
already specifies for any granted permission.

## Related documents

- `permissions.md` — the fixed risk tiers and confirmation policy this document adapts *within*, never overrides
- `docs/23-autonomy/skill-learning.md` — the asymmetric success/failure decay principle this document's reset-on-denial rule mirrors
- `docs/04-memory/persistent-user-model.md` — the structured, inspectable storage standard applied to trust records

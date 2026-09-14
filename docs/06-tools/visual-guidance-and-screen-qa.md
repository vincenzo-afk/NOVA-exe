# Visual Screen Q&A and Cursor Guidance

## Purpose

Adds two read-only, assistive capabilities built on top of the existing
Vision tier: on-demand Q&A about anything currently visible ("what's
this error?") and a visual pointer/arrow overlay that shows the user
where to look or click, rather than clicking for them. This is
deliberately scoped apart from `vision.md`'s Execution Tier 7: that
tier is about NOVA *acting* through vision-guided clicks, restricted to
an explicit allow-list because autonomous vision-driven action is
probabilistic and risky per `docs/00-overview/non-goals.md`'s RPA
boundary. Asking "what is this?" or being shown where something is
takes no action at all — it carries none of tier 7's risk, and this
document does not loosen that tier's allow-list restriction in any way.

## Scope

Read-only screen understanding and the guidance overlay. Any action the
user then chooses to take themselves is just them using their computer
normally; any action NOVA takes on the user's behalf remains fully
governed by `vision.md`'s existing tier and allow-list, unchanged.

## Screen Q&A

"What's this error?" (or any question about the current screen) — the
active window is captured once, on demand, never continuously
(distinct from `screen-streaming.md`'s phone-screen pipeline and
distinct from a standing observation mode — this is a single request,
single capture, single answer), and answered through the same vision-
capable provider routing the rest of the project already uses
(`docs/18-providers/provider-interface.md`). Because this is read-only
Q&A, it is **not** restricted to `vision.md`'s application allow-list —
the risk that restriction exists to manage (a misdetected click causing
an unintended action) doesn't apply when no action is taken. The
answer is grounded in what NOVA can actually see in the capture, with
the same honesty standard applied to any other Claude response — an
error message that's cut off or ambiguous in the capture is reported as
such, not guessed at.

## Cursor and pointer guidance

A lightweight on-screen overlay (an arrow or highlight ring, rendered by
the desktop app, not injected into the target application) pointing at
the specific button, field, or region an answer refers to — "click the
Deploy button in the top right" is more useful accompanied by an actual
arrow pointing at it than as text alone. The overlay is purely visual
and **never itself performs a click or any input** — it is the visual
equivalent of a person pointing, and disappears on its own after a
short timeout or the next user action, never persisting as a
standing UI element. Rendering it uses the same desktop-app overlay
layer other transient UI (permission confirmation prompts,
`docs/10-security/permissions.md`) already uses, not a new rendering
subsystem.

## Automatic UI navigation — where the boundary actually sits

"Automatic UI navigation based on visual understanding (not just DOM
selectors)" for arbitrary applications is exactly `vision.md`'s
Execution Tier 7 — this document does not create a second, unrestricted
navigation path around that tier's allow-list. What this document adds
on top of tier 7 is: once vision-driven navigation *is* permitted for
an allow-listed application, the same pointer-overlay mechanism above
can visually confirm each intended target *before* the click executes
— a stronger verification signal than tier 7's existing rollback
requirement alone, and a natural fit with
`docs/06-tools/computer-use-superiority.md`'s broader case for NOVA's
control being more trustworthy, not just capable.

## Invocation

Reachable two ways, both converging on the same capture-and-answer
pipeline: the global hotkey bar's quick-capture mode
(`docs/09-ui/quick-input-surfaces.md`, e.g. a bound shortcut like
`Ctrl+Shift+?`) for a fast, no-typing-needed "what's this?", and an
ordinary typed or spoken question referencing the screen in the normal
chat/voice surface. Neither path requires the user to manually
screenshot and attach anything — capture is triggered by the request
itself.

## Multi-monitor handling

The capture defaults to the display containing the currently focused
window, per the World Model's existing focus tracking
(`docs/03-runtime/world-model.md`) — not every connected display, and
never a capture of a display the user hasn't focused. A question that
references another visible display by description ("what's on my left
monitor") is resolved against the World Model's known window/display
layout before capture, the same way any other ambiguous reference is
resolved rather than guessed at.

## Latency

Because this is a single, on-demand capture rather than a continuous
stream, the round trip (capture → provider call → answer) is bounded by
one provider call, not a per-frame processing loop — there is no
standing cost when the capability isn't actively in use, consistent
with `docs/11-performance/resource-usage.md`'s general budget
discipline. A capture that is stale by the time the answer returns
(the user has since changed screens) is not re-validated automatically;
the answer is scoped explicitly to what was visible at capture time,
stated as such if the delay was long enough to matter.

## Related documents

- `docs/06-tools/vision.md` — Execution Tier 7, whose allow-list restriction this document explicitly does not loosen
- `docs/00-overview/non-goals.md` — the RPA-scope boundary behind that restriction
- `docs/18-providers/provider-interface.md` — the vision-capable provider routing this document's Q&A uses
- `docs/20-devices/screen-streaming.md` — the distinct, continuous phone-screen pipeline this document's on-demand desktop capture is not to be confused with
- `docs/10-security/permissions.md` — the existing transient-overlay rendering layer reused for the pointer guidance
- `docs/06-tools/computer-use-superiority.md` — the broader reliability argument the pre-click confirmation use of this overlay extends
- `docs/09-ui/quick-input-surfaces.md` — the global hotkey entry point into this document's Q&A
- `docs/03-runtime/world-model.md` — focus/display resolution for multi-monitor captures
- `docs/11-performance/resource-usage.md` — the on-demand, no-standing-cost budget model this capability follows

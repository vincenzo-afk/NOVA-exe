# Attention and Communication Management

## Purpose

Specifies two related capabilities NOVA currently observes but doesn't
actively manage: notification/distraction control (focus mode) and
fast outbound communication (quick contact) — closing a real gap, since
`docs/07-observers/` tracks incoming notifications but takes no action
on them, and the channel adapters (`docs/21-channels/`) can send a
message once a conversation is already framed but have no "just send
this one thing right now" fast path. Grouped together because both are
about managing the user's attention *and* their outbound
responsiveness in the same moment — a focus session and an
auto-reply are two halves of one "protect my attention, but don't go
dark" feature.

## Scope

Focus-mode session management and quick-send communication commands.
The underlying channel adapters, message composition, and contact
resolution are unchanged — this document adds a session/state layer
and a fast command surface on top of them.

## Focus mode

"Enable focus mode for 1 hour" starts a time-boxed session, tracked the
same way any other scheduled, time-boxed state is
(`docs/03-runtime/task-persistence.md`'s checkpoint model, so a crash
or restart doesn't silently cancel an active focus session). While
active:

- **Distracting sites/apps are blocked** at whichever tier can actually
  enforce it — OS-level network/app restriction where available
  (`os-system-control.md`'s tier discipline), browser-extension-level
  blocking otherwise (`docs/06-tools/automation.md`'s browser
  extension surface).
- **Notifications are silenced** by suppressing NOVA's own proactive
  surfacing of them (`docs/23-autonomy/background-life-assistant.md`'s
  existing proactive channel), not by touching the OS notification
  system itself — NOVA doesn't take over system-level Do Not Disturb,
  it stops *itself* from interrupting.
- **Pomodoro cycling** (25 min work / 5 min break) is an optional mode
  parameter on the same session, not a separate feature — a Pomodoro
  session is a focus session with a repeating internal timer boundary.

**Whitelisted urgent contacts and emergency bypass** are explicit,
user-configured exceptions checked before any suppression decision —
focus mode never silently drops a message from a whitelisted sender or
number; it only suppresses NOVA's own proactive notification behavior
for everything else. This exception list is a stated, inspectable
setting (`docs/04-memory/persistent-user-model.md`'s "structured,
never opaque" principle), not a learned or inferred behavior.

**Auto-reply during focus mode** ("In focus mode until 3pm") is sent
through the normal channel adapters (`docs/21-channels/messaging-platforms.md`)
exactly as any other outbound message would be — it inherits that
channel's existing permission tier for sending a message on the user's
behalf, it is not a privileged bypass of normal send confirmation.

## Quick contact and communication

"Message Rahul: running 10 min late," "email team meeting notes,"
"call mom," "find Priya's number" — each is a fast, single-shot
invocation of infrastructure that already exists in full:

- Contact resolution reuses Entity Resolution
  (`docs/04-memory/entity-resolution.md`) against the Knowledge Graph's
  Person nodes, exactly as any other name reference in a request would
  resolve — "quick" refers to the command's brevity, not a separate,
  simplified contact-matching mechanism.
- Channel selection (WhatsApp vs. Telegram vs. SMS vs. email) follows
  the contact's known preferred channel where NOVA has observed one, or
  asks once and remembers the choice as a stated preference
  (`docs/04-memory/persistent-user-model.md`) rather than asking every
  time.
- Sending routes through the exact same channel adapter and permission
  tier (`docs/21-channels/messaging-platforms.md`, `docs/10-security/permissions.md`)
  as any other outbound message this project already specifies — this
  document adds no new send mechanism, only a terser way to invoke the
  existing one.
- "Call mom" (a real phone call, not a chat message) routes through
  `docs/21-channels/phone-calls.md`'s existing calling mechanism,
  initiated via the Android companion where that's the calling device
  (`docs/20-devices/android-companion.md`) or VoIP where configured.

## Related documents

- `docs/07-observers/` — the notification tracking this document's focus-mode suppression acts on
- `docs/23-autonomy/background-life-assistant.md` — the proactive channel focus mode suppresses
- `docs/03-runtime/task-persistence.md` — the checkpoint model a focus-mode session's timing reuses
- `docs/06-tools/os-system-control.md` — the OS-level blocking tier focus mode prefers when available
- `docs/21-channels/messaging-platforms.md`, `docs/21-channels/phone-calls.md` — the unchanged send/call mechanisms quick contact invokes
- `docs/04-memory/entity-resolution.md`, `docs/04-memory/persistent-user-model.md` — contact resolution and remembered channel/exception preferences
- `docs/10-security/permissions.md` — the send-confirmation tier neither focus-mode auto-reply nor quick contact bypasses

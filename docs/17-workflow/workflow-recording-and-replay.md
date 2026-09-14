# Workflow Recording and Replay

## Purpose

Specifies explicit, user-initiated macro recording — "record me doing
this, then let me replay it on command" — as distinct from
`skill-learning.md`'s passive, automatic extraction from a completed
task. This is a real, separate gap: skill learning only fires after the
Verifier confirms a task NOVA itself planned and executed succeeded;
it has no mechanism for capturing a sequence the *user* performs
manually (clicking through a deploy dashboard, running a sequence of
terminal commands) that NOVA never planned or executed at all.

## Scope

Manual-recording capture, storage, replay, and sharing. Reuses
`workflow-engine.md`'s execution engine and `skill-learning.md`'s
storage/decay/safety model wherever the two mechanisms' needs coincide,
called out explicitly below rather than silently duplicated.

## Recording

"Start recording: deploy to production" begins capturing every
subsequent user-performed action through whichever observation surface
already exists for that action type — GUI automation's own event
stream for desktop actions (`docs/06-tools/automation.md`), terminal
command history for CLI sequences, and browser DOM events for browser
actions (`docs/07-observers/`) — NOVA does not add a new capture
mechanism per surface, it taps the instrumentation each surface already
has for its own automation purposes. Recording stops on an explicit
"stop recording" command, never on a timeout or heuristic guess about
when the user is "done," since an incorrectly-truncated recording would
silently produce a broken replay.

The recorded sequence is generalized into the same **step-template
shape** `skill-learning.md` already defines (concrete arguments replaced
by typed parameter slots) — a recorded workflow and a learned skill are
structurally the same artifact, just populated by two different
processes (user-performed vs. NOVA-performed-and-verified). This is why
a recorded workflow is stored as a `Skill` record
(`skill-learning.md`'s schema) with its `success_count`/`failure_count`
tracking starting fresh, rather than as a separate table — one storage
model, two entry paths into it.

## Replay

"Deploy to production" (or whatever name the user gave the recording)
resolves through the same skill-matching pipeline
`skill-learning.md` already specifies (semantic match against the
recording's trigger description), and executes through
`workflow-engine.md`'s normal DAG execution — **with full Verifier
confirmation and normal permission re-requesting at every step**,
identical to how a learned skill is replayed. A recorded macro never
gets a shortcut around verification or permissions just because a human
performed it once; the trust model is the same regardless of who
originally produced the step sequence.

## Suggested automation from repetition

Beyond explicit recording, NOVA may notice the same manual sequence
repeated several times (observed through the same per-surface
instrumentation recording uses) and **suggest** turning it into a
recorded workflow — always a suggestion requiring explicit confirmation,
never an automatically created recording, consistent with
`docs/references/feature-gap-analysis.md`'s general principle that
proactive suggestions are opt-in surfaces, not silent background
actions.

## Sharing across devices and users

A recorded workflow, being stored as a `Skill` record, is exportable as
an actual plugin exactly the way a proven learned skill already is
(`skill-learning.md`'s `createPluginScaffold` path) — sharing a
workflow template is the same mechanism as sharing any other proven
capability, not a separate export format. Cross-device availability for
one user's own recordings follows the existing cross-device sync
mechanism (`docs/28-multi-device-protocol/01-cross-device-sync.md`); a
recording is only shared *between different users* when the owner
explicitly exports and sends it, never synced to another person's
account implicitly.

## Related documents

- `docs/23-autonomy/skill-learning.md` — the storage schema, matching pipeline, decay model, and permission-re-request boundary this document reuses directly
- `docs/17-workflow/workflow-engine.md` — the DAG execution engine replay runs through
- `docs/06-tools/automation.md`, `docs/07-observers/` — the per-surface instrumentation recording taps rather than duplicating
- `docs/10-security/permissions.md` — the unchanged confirmation gate replay never bypasses
- `docs/28-multi-device-protocol/01-cross-device-sync.md` — cross-device availability of a user's own recordings

# Quick Input Surfaces: Global Hotkey, Text Expansion, Launcher, and Quick Capture

## Purpose

Specifies four fast, keyboard-first entry points that all share the
same shape — trigger instantly from anywhere on the OS, resolve
something in under a second, get out of the way — closing a real gap
against Spotlight/Alfred/Raycast-style tools and GPT-6-Astra-class
"just act on this" interaction: NOVA has a strong in-app Command
Palette (`docs/09-ui/command-palette.md`) but nothing that works
*without opening NOVA first*. Grouped as one document because they are
one interaction pattern with four entry points, not four unrelated
features.

## Scope

The system-level hotkey/trigger layer and the four surfaces built on
it. The in-app Command Palette's own resolution logic is unchanged and
reused wherever possible, per the "why not a new resolver" sections
below — this document adds reach, not a second brain.

## The shared trigger layer

A single OS-level global hotkey service (desktop app) registers a
user-configurable key combination (default `Ctrl+Shift+N` /
`Cmd+Shift+N`) that works regardless of which application currently has
focus — this requires the desktop app's own native runtime tier
(`docs/06-tools/execution-priority.md`'s Native Runtime tier), since a
global OS hotkey is a platform API, not something reachable through
Accessibility or Vision. On trigger, a small floating, always-on-top
window opens with focus, pre-empting nothing else running — closing it
(`Esc`, click-away, or task completion) returns focus to whatever was
active before, so this never disrupts the user's actual work the way a
full window switch would.

## 1. Global hotkey command bar

The floating window opens directly into the same resolution pipeline
the in-app Command Palette already uses
(`docs/09-ui/command-palette.md`'s deterministic-first resolution,
Entity Resolution for fuzzy names, permission gating for anything
beyond read-only) — this is the existing Command Palette, reachable
from anywhere, not a second implementation of command resolution. The
only new code is the trigger and the floating-window chrome.

## 2. Text expansion and snippets

A small, local trigger-string → expansion-text table (`;email`,
`;addr`, `;intro`, etc.), expanded inline wherever the user is
typing, via the same input-injection primitive already specified for
automation (`docs/06-tools/automation.md`'s lowest tier) — deliberately
the *last*-resort tier there, but here it's the *only* mechanism that
makes sense, since expansion has to happen inside whatever arbitrary
app the user is typing in, not through that app's own API.

Snippets are **stored as structured records the user can inspect, edit,
and delete**, following the same "structured, not opaque" principle
`docs/04-memory/persistent-user-model.md` applies to the rest of what
NOVA remembers — a snippet is data, not a hidden model behavior.
AI-generated snippets (e.g., "write a polite follow-up email" → saved
as `;followup`) go through the same generation path as any other
Claude-authored text, with the user reviewing and confirming the
generated content before it's saved as a reusable trigger — NOVA never
silently promotes an ad hoc response into a standing, silently-injected
snippet without that confirmation step.

## 3. App and file launcher

Fuzzy matching over installed applications and the filesystem — the
same Entity Resolution mechanism the Command Palette already uses for
fuzzy project/file names (`docs/04-memory/entity-resolution.md`), with
two additions specific to a launcher: (a) an indexed application list
built once at startup and refreshed on a change-watch rather than
scanned live per keystroke, and (b) ranking by recency and frequency of
launch, reusing `docs/04-memory/memory-ranking.md`'s existing
recency/frequency model rather than a separate "frecency" algorithm.
File search respects the same permission boundary as any other
filesystem access (`docs/10-security/permissions.md`, path containment
enforcement) — the launcher cannot surface a file from outside NOVA's
already-granted filesystem scope just because it matched a fuzzy query.

## 4. Quick note and capture

The same hotkey surface's second mode: a minimal capture field that
timestamps and context-tags whatever is entered (typed or spoken, using
the existing voice pipeline, `docs/22-voice/voice-assistant.md`) and
writes it into memory through the normal ingestion path
(`docs/04-memory/memory-architecture.md`), not a separate notes store.
"Note: call mom at 5pm" is parsed the same way any natural-language
reminder request already is
(the Planner's normal intent handling) — quick capture is a faster
*entry point* into existing memory and task creation, not a parallel
system with its own rules. "Save this link" and "screenshot this"
reuse the World Model's existing knowledge of the active
window/browser tab (`docs/03-runtime/world-model.md`) to know what
"this" refers to without the user having to specify it.

## Why none of this needed a new resolution engine

Every one of these four surfaces is a new *entry point* into mechanisms
this project already specifies in full: Command Palette resolution,
Entity Resolution, memory ingestion, the Planner's intent handling, and
the lowest automation tier for the one case (text expansion) that
genuinely has no better option. The only genuinely new component is the
global hotkey trigger and its floating-window UI.

## Related documents

- `docs/09-ui/command-palette.md` — the in-app resolution pipeline the global hotkey bar reuses directly
- `docs/06-tools/execution-priority.md`, `docs/06-tools/automation.md` — the native-runtime hotkey registration and lowest-tier input injection this document depends on
- `docs/04-memory/entity-resolution.md`, `docs/04-memory/memory-ranking.md` — fuzzy matching and ranking reused by the launcher
- `docs/04-memory/memory-architecture.md`, `docs/04-memory/persistent-user-model.md` — where captured notes and snippets actually live
- `docs/03-runtime/world-model.md` — resolves "this" in "screenshot this" / "save this link"
- `docs/10-security/permissions.md` — the filesystem scope the launcher's file search respects
- `docs/29-product/keyboard-shortcuts.md` — where this hotkey's default binding is documented for the user

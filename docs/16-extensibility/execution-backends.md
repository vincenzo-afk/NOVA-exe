# Sandboxed Execution Backends

## Purpose

Specifies a pluggable execution-backend model so code NOVA runs on the
user's behalf can target whichever environment actually fits the
task — a quick local script versus an isolated container for something
riskier — closing the gap where `nova sandbox` is a documented CLI
command with no backing implementation, and where `PluginManager`'s
`sandbox` option is currently unbacked (`docs/references/feature-gap-analysis.md`, row 6).

## Scope

The backend abstraction and its first two concrete implementations
(local, Docker). General process-isolation principles are
`docs/10-security/sandboxing.md`; plugin-specific isolation is
`plugin-sandboxing.md`. This document is the execution layer both of
those rely on when a task needs to *run* something, not just call a
registered tool.

## The ExecutionBackend interface

A small interface in `services/runtime/src/`:

```
interface ExecutionBackend {
  run(command: Command, options: ExecutionOptions): Promise<Result<ExecutionOutput>>
}
```

Every concrete backend implements this one shape. The interface is
deliberately minimal and injected-collaborator style — the same pattern
already used elsewhere in the runtime (the CLI's command handlers,
entity resolution's semantic matcher, App Control's intent resolver) —
so that a new backend is a drop-in addition, never a redesign of the
callers that use one.

## First two backends

- **Local** — direct subprocess execution. The most restrictive default
  and the one every installation can run without any additional
  infrastructure. This is the fallback backend and the one used when no
  other backend is explicitly selected.
- **Docker** — the most broadly useful isolated backend, and the one
  most users can run without a paid third-party account. Provides real
  filesystem and process isolation from the host for code whose
  provenance or risk level doesn't warrant running directly on the
  user's machine.

Both are required before this feature is considered complete; Docker
without a working local fallback would make sandboxed execution
unavailable to anyone without Docker installed, and local without Docker
would leave the "isolated" half of the feature unimplemented.

## Later backends

The interface is shaped so that cloud/remote backends (Daytona, Modal,
Singularity, SSH-based execution, Vercel Sandbox) are addable later
without touching existing callers — each is just another
`ExecutionBackend` implementation. These are explicitly out of scope for
the initial build; they are named here only so the interface is designed
with them in mind from the start, matching Hermes Agent's seven-backend
breadth as a future direction rather than an initial requirement.

## Backend selection is permission-gated, not a silent default

Unlike a self-hosted, single-user tool where backend choice is purely an
operator preference, NOVA's permission model treats backend selection as
a risk-tier decision in its own right: running arbitrary code in a fresh
Docker container is a materially different risk from running it locally
(different resource consumption, different blast radius, different data
exposure if the container has network access). Backend selection routes
through the same risk-tiered confirmation flow as any other capability
(`docs/10-security/permissions.md`) — it is never silently chosen on the
user's behalf, and a task requiring a specific backend surfaces that
requirement as part of its normal permission request, not as an
invisible implementation detail.

## Wiring

- `nova sandbox` (the currently unwired CLI command) is implemented
  directly against this interface — selecting or inspecting available
  backends, running an ad hoc command through one, and reporting results
  through the same structured output pattern (`docs/27-cli/`) the rest of
  the CLI uses.
- `PluginManager`'s existing but currently unbacked `sandbox` option
  (`services/runtime/src/plugin-manager.ts`) is wired to this interface
  so that `nova plugin test` actually executes a plugin under test
  somewhere real, rather than being a documented no-op — this directly
  unblocks the plugin-testing workflow described in `plugin-lifecycle.md`.

## Resource limits and crash handling

Every backend enforces the same resource-ceiling and crash-isolation
principles `plugin-sandboxing.md` already establishes for plugin
processes — a backend-run process has its own CPU/memory ceiling
independent of core service budgets (`docs/11-performance/resource-usage.md`),
and a crash or resource-limit violation is reported to the Planner as a
failed step requiring replanning, never as a silent core-service
failure.

## Related documents

- `docs/references/feature-gap-analysis.md` — the competitive analysis this document implements (row 6)
- `docs/10-security/sandboxing.md` — the general process-isolation model this document's backends implement against
- `plugin-sandboxing.md` — the plugin-specific isolation model that shares this document's resource/crash-handling principles
- `docs/10-security/permissions.md` — the risk-tiered gate on backend selection
- `plugin-lifecycle.md` — the `nova plugin test` workflow this document unblocks
- `services/runtime/src/plugin-manager.ts` — the existing unbacked `sandbox` option this document wires up

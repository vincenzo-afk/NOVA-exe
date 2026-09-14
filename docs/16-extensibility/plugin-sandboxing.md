# Plugin Sandboxing

## Purpose

Specifies the process isolation model for plugin code, extending
`docs/10-security/sandboxing.md`'s process-isolation principle to
third-party plugin execution specifically.

## Scope

Plugin-specific process isolation. General sandboxing model is
`docs/10-security/sandboxing.md`.

## Process isolation

Every enabled plugin runs as its own external process, never loaded
in-process with any NOVA service — identical in principle to how MCP
servers are isolated (`docs/06-tools/mcp.md`,
`docs/10-security/sandboxing.md`). A plugin process cannot directly
access NOVA's own service process memory, Memory storage, or Knowledge
Graph storage; all interaction happens through the tool-invocation
interface the Executor calls into (`docs/03-runtime/executor.md`).

## Process communication transport

Transport between NOVA and a plugin process is a dedicated named pipe
established by the Plugin Manager at process spawn time, using the same
local-IPC mechanism as NOVA's own inter-service communication
(`docs/02-architecture/communication-model.md`) — never a raw local
socket and never multiplexed over the process's stdio streams. The
plugin process's stdout/stderr are captured separately, for logging
only (`docs/13-devops/logging.md`), and are never parsed as protocol
data; this keeps a plugin's own arbitrary console output from being
misinterpreted as a tool-invocation response. This differs deliberately
from MCP's own stdio-based local transport (`docs/06-tools/mcp.md`)
because NOVA does not control what a third-party plugin writes to its
own stdout, whereas MCP's specification mandates strict JSON-RPC framing
on that stream.

## Resource limits

Each plugin process is subject to a configurable CPU/memory ceiling,
independent of the core resource budget in
`docs/11-performance/resource-usage.md` — a misbehaving or resource-heavy
plugin is contained to its own limit and does not compete with or
degrade core NOVA services' resource allocation.

## Filesystem and network access

A plugin process receives no filesystem or network access beyond what is
explicitly required by its granted permission scope
(`plugin-permissions.md`) — this is enforced at the OS process level
(restricted process token / network namespace, depending on platform
capability) wherever the underlying OS supports it, not only at the
application logic level, providing defense in depth consistent with
`docs/10-security/threat-model.md`'s general posture of not relying on a
single layer of control.

## Crash isolation

A plugin process crashing is handled the same way any external tool
source failing is handled (`docs/06-tools/mcp.md`'s trust boundary
model) — it does not affect any core NOVA service, and any in-flight
task depending on that plugin's tools is reported to the Planner as a
failed step requiring replanning, per `plugin-lifecycle.md`'s
deregistration behavior.

## Related documents

- `docs/25-failure-modes/FM-19-plugin-ecosystem.md` — failure modes for this subsystem
- `docs/10-security/sandboxing.md` — the general process-isolation model
  this document extends
- `plugin-permissions.md` — the permission scope enforced at the OS level
  here
- `docs/06-tools/mcp.md` — the analogous external-process trust model for
  MCP servers
- `docs/16-extensibility/execution-backends.md` — the pluggable local/
  Docker execution layer that `nova plugin test` runs against, sharing
  this document's resource-limit and crash-isolation principles

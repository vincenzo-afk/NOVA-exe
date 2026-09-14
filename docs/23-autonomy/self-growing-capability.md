# Self-Growing Capability

## Purpose

Specifies the general principle behind
`autonomous-plugin-discovery.md` and `automatic-software-installation.md`:
NOVA's capability surface is designed to grow at runtime in response to
what the user needs, rather than being fixed at build time — "need
feature → NOVA builds capability → uses it forever."

## Scope

This document is the unifying policy statement; the concrete mechanisms
are the two documents above plus a third path — generated tool
composition — specified here.

## Three growth mechanisms

1. **Install an existing plugin/MCP server** —
   `autonomous-plugin-discovery.md`, for capabilities the ecosystem
   already provides.
2. **Install existing third-party software** —
   `automatic-software-installation.md`, for capabilities that require an
   external application rather than a NOVA plugin.
3. **Compose a new tool from existing primitives** — where a repeated
   user need has no existing plugin or application (e.g., "always
   summarize my inbox this specific way every Monday"), NOVA may generate
   a saved, named **Composite Tool**: a fixed sequence or small script
   built entirely from already-permitted tool calls
   (`docs/06-tools/tool-registry.md`), registered as a first-class tool
   for reuse. A Composite Tool is not arbitrary generated code executed
   outside the sandbox — it is a saved plan through already-approved
   tools, reviewable and deletable like any saved automation, and it
   inherits the permission scope of the tools it composes rather than
   gaining new privileges by being saved.

## "Uses it forever"

Once installed or composed, a capability persists in the Capability
Registry / Tool Registry across restarts exactly like any other
configured provider or plugin — there is no separate "temporary
capability" tier that evaporates. It appears in Settings alongside
manually installed items, editable and removable the same way.

## Boundary: what does not grow

- **The knowledge graph ontology remains fixed and versioned**
  (`docs/04-memory/ontology.md`) — self-growing capability is scoped to
  the tool/plugin/provider surface, not to NOVA inventing new memory
  schema at runtime. This boundary is restated explicitly because it is
  the one item `docs/15-decisions/adr-0008-v5-architecture-evolution.md`
  did not repeal.
- **No capability grows its own permission scope.** A Composite Tool, an
  installed plugin, or an installed application only ever operates within
  permissions the user has explicitly granted to its constituent actions.
- **Every growth path passes through an explicit approval step** —
  discovery and composition can happen autonomously; installation and
  first use of a materially new permission scope cannot.

## Related documents

- `docs/25-failure-modes/FM-18-autonomy-policy-approval.md` — failure modes for this subsystem
- `autonomous-plugin-discovery.md`, `automatic-software-installation.md`
  — the two registry-backed growth mechanisms
- `docs/06-tools/tool-registry.md` — where Composite Tools register
- `docs/04-memory/ontology.md` — the explicitly preserved fixed boundary
- `docs/10-security/permission-escalation.md` — approval mechanics shared
  by all three mechanisms
- `strategy-evaluation.md` — the complementary comparison/retirement
  layer for when multiple strategies exist for the same recurring goal;
  this document covers acquisition only, not evaluating what's acquired
- `skill-learning.md` — the fourth growth path: learning a reusable
  procedure from a task NOVA already completed, rather than installing
  or composing from existing tools; a proven learned skill converges
  with this document's Composite Tool mechanism via `createPluginScaffold`

# Comparisons

## Purpose

Positions NOVA against adjacent categories of existing tools, clarifying
what NOVA is not (per `docs/00-overview/vision.md`) with concrete
architectural contrast rather than assertion alone.

## Scope

Categorical comparison. Specific design-pattern lineage is
`inspirations.md`.

## NOVA vs. chatbots

A chatbot's context is bounded by the current conversation. NOVA
maintains structured, tiered memory and a persistent Knowledge Graph
(`docs/04-memory/`) that spans sessions, and can autonomously act on the
user's behalf rather than only responding in text — the fundamental
architectural difference is persistent, structured state versus
conversation-scoped context.

## NOVA vs. AI coding assistants

A coding assistant's scope is typically one editor and one codebase.
NOVA's Observer layer (`docs/07-observers/`) spans the entire workspace —
files, applications, browser, terminal — and its Knowledge Graph
represents relationships across projects, not within a single one. A
coding assistant could be one of many tools NOVA orchestrates through the
Tool Registry (`docs/06-tools/tool-registry.md`), rather than NOVA
attempting to replace it.

## NOVA vs. generic automation/RPA tools

Traditional RPA tools execute predefined workflows against a fixed script.
NOVA's Planner (`docs/03-runtime/planner.md`) reasons against open-ended
goals, using deterministic execution wherever possible
(`docs/05-ai/deterministic-first.md`) and falling back to GUI automation
only as a last, narrowly-scoped resort (`docs/06-tools/vision.md`) rather
than GUI automation being the primary mechanism, which is the
traditional RPA approach.

## NOVA vs. general-purpose computer-use agents

Contemporary computer-use agents commonly treat vision-guided GUI control
as a general, first-choice mechanism for operating a computer. NOVA
inverts this: GUI/vision control is the last tier in a fixed priority
chain (`docs/06-tools/execution-priority.md`), used only when every
structured method (native, API, MCP, CLI, accessibility) is unavailable,
and restricted to an explicit application allow-list rather than general
applicability.

## NOVA vs. an operating system

NOVA runs on top of an existing OS, using its existing primitives
(filesystem, process model, accessibility APIs) rather than replacing any
of them (`docs/00-overview/vision.md`). It has no kernel, no device
driver layer, and no process-scheduling authority over anything but its
own supervised services (`docs/02-architecture/system-architecture.md`).

## NOVA vs. contemporary autonomous agents (2026)

Distinct from the categorical comparisons above, NOVA is also
positioned against a specific cohort of current-generation autonomous
agents — GPT-6 Astra, Project Astra, OpenClaw, Manus, and Hermes
Agent — each strong in a different dimension (OS-level operation,
physical-world perception, task resilience, authenticated-session
automation, and closed-loop skill learning, respectively). That
comparison is dated, detailed, and tied to a concrete build plan rather
than a general positioning statement, so it is tracked separately in
`feature-gap-analysis.md` rather than here.

## Related documents

- `docs/00-overview/vision.md` — the identity statement these comparisons
  support
- `inspirations.md` — the design-pattern lineage behind NOVA's specific
  architectural choices
- `feature-gap-analysis.md` — the dated, competitor-by-competitor gap
  analysis and resulting build plan

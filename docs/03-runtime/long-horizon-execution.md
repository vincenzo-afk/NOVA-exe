# Long-Horizon Execution

## Purpose

Specifies sustained, multi-hour, multi-program task execution with
periodic progress surfacing — the specific dimension where NOVA's
existing computer-use mechanism is already strong but under-proven
against GPT-6 Astra's headline claim of unsupervised, multi-hour,
multi-program workflows (`docs/references/feature-gap-analysis.md`,
row 2). This is a proof-and-hardening document, not a new mechanism
document: the pieces already exist.

## Scope

Task budget tracking for long-running work, progress-reporting behavior
during execution, and the concrete workflow templates that prove
multi-app coverage. This document does not introduce a new execution
engine — it configures and extends the existing Workflow Engine
(`workflow-engine.md`), GUI automation (`automation.md`), and World
Model (`docs/03-runtime/world-model.md`) for sustained operation.

## What already exists

NOVA's existing pieces already form exactly the shape this capability
needs: GUI automation for controlling applications
(`docs/06-tools/automation.md`), the World Model's window z-order
tracking for knowing what's actually visible and interactable
(`docs/03-runtime/world-model.md`), the Workflow Engine's multi-step
execution with checkpointing (`workflow-engine.md`), and the desktop
app's full IPC surface for cross-application control (`apps/desktop/`).
What's missing isn't a mechanism, it's **breadth of proven task
coverage** and explicit **duration handling** — the difference between
"technically capable of a long task" and "reliably runs one for hours
unsupervised with visible progress."

## Long-horizon task budget class

`docs/11-performance/resource-usage.md` already tiers resource budgets
by task class. This document adds an explicit **multi-hour task class**
that the Workflow Engine's existing per-node `timeout_ms` can be
configured against — a long-horizon task is not simply a normal task
with a bigger timeout, it is a distinct budget tier with its own
progress-reporting cadence (below) and its own resource ceiling, so a
single runaway long task cannot silently consume resources a normal
task's budget would have caught.

## Progress surfacing, not silent execution

GPT-6 Astra's "AI as the user" framing implies full autonomy with no
described progress-reporting model. NOVA's differentiator here is
explicit: a long-horizon task periodically checkpoints and reports
progress at intervals during execution, not only at the end. This reuses
the structured logging/tracing infrastructure already built
(`packages/shared/src/tracer.ts`, surfaced via `nova traces <correlation-id>`)
— every meaningful state transition during a long task emits a span, so
a user (or the Task Monitor / Mission Control dashboard,
`mission-control-dashboard.md`) can see *what NOVA is currently doing*
partway through a multi-hour run, not just a final status. This is a
trust feature as much as a usability one: an agent running unsupervised
for hours with zero visibility into intermediate state is a materially
worse product than one that surfaces its own progress, independent of
raw capability.

## Checkpoint cadence for long tasks

Long-horizon tasks checkpoint more frequently than the Workflow Engine's
default cadence for short tasks — proportional to task duration rather
than a fixed interval, so a multi-hour task's crash-recovery point
(`docs/03-runtime/task-persistence.md`) is never more than a few minutes
of lost work behind, consistent with the same conservative
crash-recovery posture (`recoverAfterCrash()` re-validating rather than
blindly resuming) already established for shorter tasks.

## Cross-application workflow templates — the actual proof

A capable engine is not the same as a proven one. This document requires
a small library of **concrete, tested, multi-app workflow definitions**
as evidence the capability works end-to-end, not just that the engine
could theoretically run them:

- **Spreadsheet-fill** — populate and validate a spreadsheet from a
  mixed set of source documents, exercising cross-application data
  transfer and GUI automation together.
- **Research-to-report** — multi-source research culminating in a
  generated document (`docs/06-tools/` document-generation skills),
  exercising sustained information-gathering plus deliverable assembly.
- **Code-change-to-PR** — a development workflow from a described change
  through to an opened pull request, exercising terminal, editor, and
  browser/version-control automation together.

Each template is benchmark-facing work (`vision-benchmarking.md`'s
broader evaluation effort) as much as engineering work — proving
duration and breadth is the actual claim being made against GPT-6 Astra,
and an unproven template is not evidence.

## Where NOVA differentiates rather than matches

GPT-6 Astra is described with no explicit permission-gating model —
framed as full autonomy. NOVA's existing risk-tiered permission and
confirmation architecture (`docs/10-security/permissions.md`, respected
throughout the desktop app's `AppController` and the CLI) is a real
product differentiator here if built and marketed correctly: a
long-horizon task still checks in at risk-tier boundaries rather than
having unconditional standing authority to do anything for hours
unattended. This is a better product for anyone uncomfortable handing
over full OS control — which is most people — and it should not be
diluted in the name of matching a competitor's framing of full autonomy.

## Related documents

- `docs/references/feature-gap-analysis.md` — the competitive analysis this document implements (row 2)
- `workflow-engine.md` — the multi-step execution and checkpointing mechanism this document configures for long-running work
- `docs/06-tools/automation.md` — GUI automation, the mechanism for controlling individual applications
- `docs/03-runtime/world-model.md` — window/focus tracking long tasks rely on to know what's actually interactable
- `docs/11-performance/resource-usage.md` — the budget tiering this document extends with a multi-hour class
- `docs/03-runtime/task-persistence.md` — the crash-recovery model whose checkpoint cadence this document tightens for long tasks
- `packages/shared/src/tracer.ts` — the tracing infrastructure progress surfacing reuses
- `mission-control-dashboard.md` — where long-task progress is visualized in real time
- `docs/10-security/permissions.md` — the permission architecture that differentiates NOVA's long-horizon autonomy from unconditional autonomy

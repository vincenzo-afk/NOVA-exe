# Failure Pattern Analysis

## Purpose

Adds the one piece `18-failure-and-recovery-contracts.md` deliberately
doesn't cover: looking *across* many past failures to notice a
recurring pattern, rather than handling each incident in isolation.
That document specifies exactly what happens the moment a Planner,
Executor, Verifier, Memory Manager, or plugin fails — restore, retry,
escalate, per a fixed decision flow. This document is the meta-layer on
top: if the same failure shape keeps recurring, that's a signal worth
surfacing on its own, separate from any single incident's own recovery.

## Scope

Cross-incident pattern detection over the existing failure/recovery
event log, and what NOVA does once a pattern is detected. Does not
change any single incident's own recovery decision flow — every
individual failure still resolves exactly as
`18-failure-and-recovery-contracts.md` specifies, unaffected by whether
a pattern is later detected across several of them.

## What counts as a pattern

A pattern is a **repeated failure with a shared, specific cause
signature** — the same tool failing with the same error class, the
same plugin crashing on the same trigger condition, the same external
API returning the same failure code — observed a minimum number of
times within a bounded lookback window. A handful of superficially
similar but differently-caused failures (different tools, different
error classes, coincidentally close in time) is explicitly **not** a
pattern; the detector matches on cause signature, not just failure
frequency, to avoid manufacturing a false pattern out of ordinary,
unrelated noise.

## Data source

Pattern detection reads the existing append-only event log
(`17-event-and-internal-api-contracts.md`'s event log,
`18-failure-and-recovery-contracts.md`'s consistency-guarantee table)
— it introduces no new logging, only a periodic analysis pass over data
already being written for other reasons (audit, debugging, tracing via
`packages/shared/src/tracer.ts`). This keeps detection honest about its
own cost: it is a scheduled analysis job
(`docs/03-runtime/job-scheduler.md`, the same scheduling substrate
`background-life-assistant.md` uses), not a continuously-running
inference process.

## What happens once a pattern is detected

Detection produces a **surfaced signal, never a silent autonomous
fix.** Depending on the pattern's cause signature:

- **A specific tool/plugin repeatedly failing** — surfaced to the user
  as a flagged issue ("the GitHub integration has failed the same way
  5 times this week — see details?"), with the option to disable that
  tool, re-authenticate it, or escalate to Anthropic feedback
  (`docs/responding_to_mistakes_and_criticism`-equivalent in-product
  path) — never auto-disabled without the user's own decision, since a
  tool the user still wants working should not silently disappear.
- **A recurring destructive-tier action being denied** — surfaced as a
  candidate for `docs/10-security/adaptive-trust.md`'s trust-scope
  review, *never* as an automatic loosening of that tier's confirmation
  requirement — `adaptive-trust.md`'s own rule that destructive-tier
  confirmation has no override applies here without exception; a
  detected pattern can prompt the user to reconsider a scope's tier
  assignment, it cannot change that assignment itself.
- **A recurring transient failure with a known compensating action** —
  where the existing per-incident retry logic already has a documented
  alternative strategy (`18-failure-and-recovery-contracts.md`'s
  Planner-crash decision flow, "retry with a simplified/alternative
  strategy"), a detected pattern can promote that alternative to the
  **first** attempted strategy for that specific failure signature
  going forward, rather than always trying the original approach first
  and only falling back after another failure. This is the one case
  where pattern detection changes future behavior automatically —
  because it only ever reorders between already-sanctioned recovery
  strategies, never introduces a new one and never skips verification
  or confirmation on any individual attempt.

## Rollback and compensation

For a failure pattern tied to a specific class of destructive action
that partially completed before failing, this document defers entirely
to each subsystem's own compensation logic already specified in
`18-failure-and-recovery-contracts.md`'s per-subsystem table (e.g., the
Memory Manager's transactional rollback) — pattern analysis identifies
*that* a class of action keeps failing partway; it does not invent a
new rollback mechanism, since a bespoke, generic rollback across
arbitrary subsystems would risk exactly the kind of unverified,
irreversible state change the rest of this project is built to avoid.

## Related documents

- `docs/26-system-reference/18-failure-and-recovery-contracts.md` — the per-incident decision flow this document adds cross-incident detection on top of, unchanged
- `docs/03-runtime/job-scheduler.md` — the scheduling substrate this document's periodic analysis pass runs on
- `docs/10-security/adaptive-trust.md` — where a detected denial pattern is surfaced for review, never auto-resolved
- `docs/05-ai/escalation-rules.md` — the human-escalation path a detected tool/plugin pattern surfaces into
- `17-event-and-internal-api-contracts.md` — the event log this document's detector reads, introducing no new logging surface

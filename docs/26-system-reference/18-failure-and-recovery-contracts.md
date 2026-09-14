# Failure, Recovery & Consistency Contracts

## Purpose

For every subsystem: what happens if it fails, exactly what recovery
point it resumes from, and what consistency guarantee its data carries
during and after that recovery — per Sections 8, 9, and 10 of the master
documentation outline. `docs/03-runtime/failure-recovery.md` and `docs/25-failure-modes/` describe the mechanisms in depth; this document
is the fast-reference decision flow and guarantee table so an
implementer doesn't have to re-derive "what should happen here" per
subsystem.

## Scope

The failure→recovery decision flow for the five subsystems in
`15-build-contracts.md`, plus the system-wide recovery scenarios listed
in the master outline (power loss, crash, network failure, disk full,
model unavailable, plugin crash, permission denied, partial execution),
plus the consistency guarantee each major store provides.

## Failure contracts (decision flow per subsystem)

### Planner crashes mid-plan

Restore last checkpoint → retry planning once with the same context →
if it fails again, retry with a simplified/alternative strategy → if
that fails, escalate to the human (`docs/05-ai/escalation-rules.md`).
Never silently produce a partial plan and hand it to the Executor.

### Executor crashes mid-step

Restore from the step's pre-execution checkpoint → if the step was
read-only or already confirmed idempotent, retry automatically → if the
step was destructive-irreversible, abort and escalate rather than retry
blindly (`docs/03-runtime/planner-executor-contract.md`'s risk tiers).

### Verifier fails to produce a verdict (crash or timeout)

Treat as an inconclusive verdict, never as an implicit pass — retry the
verification once, then escalate. An inconclusive verdict never
auto-resolves to "accept."

### Memory Manager write fails

Roll back the partial graph mutation (transactional write, per
`persistence.md`) → retry once → if it still fails, the triggering task
is marked degraded (memory not updated) but is not itself failed,
since a Memory Manager outage must not block unrelated task progress.

### Plugin Host: plugin fails to load or crashes

Isolate the plugin, mark it disabled with a visible reason, continue
host operation — never retry a crashed plugin automatically forever
(`docs/37-edge-cases/plugin-crash.md`).

## System-wide recovery scenarios

For each: **recovery point**, **expected behavior**, **consistency
guarantee** carried through the recovery.

| Scenario | Recovery point | Expected behavior | Consistency guarantee |
|---|---|---|---|
| Power loss | Last durable checkpoint | Resume from checkpoint on restart; no partial writes replayed twice | Durable store: strong (transactional); in-flight state: lost, by design |
| Process crash | Last durable checkpoint | Runtime Manager restarts the service (`service-lifecycle.md`); Task resumes at last confirmed step | Strong for committed state |
| Network failure | Last successfully synced state | Queue operations locally per the event bus's at-least-once delivery (`docs/02-architecture/communication-model.md`); AI-capability calls fail over to a local provider per `docs/18-providers/provider-routing.md`'s Offline Fallback section; sync on reconnect | Eventually consistent across devices during the outage |
| Disk full | Last write that succeeded before the failure | Reject new writes with a specific error, do not corrupt existing data, alert the user | Strong (writes either fully succeed or are rejected, never partial) |
| Model/provider unavailable | N/A — no state was mutated | Fail over to next provider in `docs/05-ai/model-routing-matrix.md`, or degrade to deterministic path | Not applicable — no persisted state involved |
| Plugin crash | Plugin's own last checkpoint, if any (host has none) | Isolate and disable; host state unaffected | Host store: unaffected; plugin's private state: undefined, plugin's responsibility |
| Permission denied (mid-operation) | The operation's pre-attempt state | Abort that operation, emit audit event, continue surrounding task | Strong — the denied operation has no partial effect |
| Partial execution (task interrupted between steps) | The last step boundary | Resume at the next unexecuted step; already-executed steps are not re-run unless explicitly non-idempotent and unconfirmed | Strong per step; the task overall is only eventually complete |

## Consistency guarantees by store

- **Task store:** strongly consistent, transactional per task.
- **Memory / knowledge graph:** strongly consistent for writes to a
  single workspace's graph; eventually consistent across devices during
  sync (`persistence.md`, Sync).
- **Checkpoints:** immutable and append-only — never mutated in place
  (`system-invariants.md`).
- **Configuration:** strongly consistent locally; last-writer-wins
  across devices with a visible conflict indicator if two devices
  changed it concurrently.
- **Event log:** append-only, at-least-once delivery, consumers must be
  idempotent (see `17-event-and-internal-api-contracts.md`).

## Maintenance rule

A new subsystem or store added to the system must have an entry added
to this document's tables in the same change — an undocumented failure
path is exactly the ambiguity Section 8 of the master outline exists to
close.

## Related documents

- `failure-pattern-analysis.md` — the cross-incident detection layer built on top of this document's per-incident decision flow, unchanged by it

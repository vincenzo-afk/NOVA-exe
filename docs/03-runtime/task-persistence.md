# Task Persistence and Crash Recovery

## Storage boundary

Task checkpoints are persisted in the existing Prisma/SQLite memory service as
rows in `task_checkpoints`. The memory service owns the database client and
checkpoint serialization. Runtime depends on the declared persistence
contract, not on Prisma internals, so the Task Manager and Executor remain
independent of the storage implementation.

Each checkpoint stores the complete task record required by
`docs/03-runtime/task-manager.md`: task ID, goal, correlation ID, current
lifecycle state, retry count, full step history, optional waiting-user reason,
optional failure/cancellation reason, and the update timestamp. Every row is
scoped to a workspace.

## Immutable checkpoint history

A task creation writes a `Created` checkpoint. Every lifecycle transition and
every step-history append writes a new `Valid` checkpoint in the same database
transaction that supersedes the prior `Created` or `Valid` checkpoint for that
task. Checkpoints are never edited in place. `Superseded` rows remain in the
history for audit and recovery diagnostics; the newest non-superseded row is
the resumption target.

The persistence adapter returns a `Result` for storage failures. The durable
coordinator path writes the `Created` checkpoint before returning the task
submission result. During execution, transition and step-history mutations
write their checkpoint before the corresponding progress event is published.

## Crash recovery

On startup, `RuntimeApplication` calls `recoverAfterCrash` before opening its
REST and WebSocket listeners. The adapter loads the newest checkpoint for each
workspace task. Records in `Executing` or `Verifying` are written as a new
`Unverified` checkpoint because their external outcome cannot be confirmed.
Records in `Paused` or `WaitingUser` remain in their existing state. The
recovered records are restored into the authoritative `TaskManager`, which
preserves their task IDs, correlation IDs, retry counts, reasons, and step
history.

A failed recovery read prevents the application from opening its listeners;
the runtime does not silently start with an empty task set. A malformed
checkpoint produces `NOVA-EVT002`, while an underlying database failure
produces the retryable memory-storage error contract.

## Composition

`RuntimeApplicationOptions.persistence` accepts the declared checkpoint and
recovery interfaces. The Prisma-backed `TaskCheckpointStore` from
`@nova/memory` is the production adapter. Hosts are responsible for supplying
the workspace identity and a migrated SQLite database before starting the
application. This keeps migration and OS-user storage-path ownership at the host boundary rather than hiding it in a task-state component. The Electron host realizes this boundary by persisting one workspace UUID in its per-user `userData` directory, using `<userData>/memory/structured/nova.db`, applying the bundled migrations before runtime startup, and closing the Prisma client after listener shutdown.


## Verification

The memory test suite uses a real SQLite database and applies the repository
migrations before exercising checkpoint creation, supersession, latest-state
loading, and restart recovery. Runtime tests verify write-before-acknowledgment,
startup restoration, and the `Executing`/`Verifying` to `Unverified` boundary.

## Related documents

- `docs/17-workflow/session-fork-rewind.md` — the user-facing fork operation
  built on top of this same checkpoint data, without altering this
  document's crash-recovery contract
- `docs/23-autonomy/skill-learning.md` — the other consumer of a completed
  execution's checkpoint history, extracting a reusable Skill from it once
  the Verifier confirms success

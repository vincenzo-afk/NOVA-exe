# Ordering, Concurrency, Retry, Timeout & Resource Limit Rules

## Purpose

Concrete, numeric operational rules for the five closely related
concerns in Sections 11 through 15 of the master documentation outline.
Where other documents describe *that* something is retried, ordered, or
bounded, this document states the actual policy — so an implementer
does not have to invent a backoff curve or a timeout value.

## Scope

System-wide defaults. A subsystem may declare a documented, justified
override in its own contract; where it doesn't, these defaults apply.

## Ordering guarantees

The canonical mutation order for a single task's lifecycle is fixed and
never reordered:

```
Observation → Reflection → Memory Update → Checkpoint → Notification
```

Within this chain, each stage is only invoked after the previous stage's
event is durably recorded (`persistence.md`) — a Checkpoint is never
written before the corresponding Memory Update event exists, because a
component recovering from a checkpoint must be able to trust that
everything the checkpoint implies already happened. Across *different*
tasks in the same workspace, no ordering guarantee is made or needed —
concurrent tasks are independent unless they declare a shared resource
lock (see Concurrency Rules).

## Concurrency rules

- **Can run simultaneously by default:** Planner, Verifier, Indexer,
  Search, and Memory reads — none of these hold an exclusive lock on
  shared mutable state.
- **Serialized by default:** Executor steps that declare overlapping
  `required_locks` (`docs/03-runtime/resource-manager.md`) — two steps
  that touch the same file or the same external resource never execute
  concurrently.
- **Plugins:** run concurrently with each other and with core
  subsystems by default, each in its own sandbox; a plugin never blocks
  a core subsystem's progress (isolation guarantee,
  `docs/16-extensibility/plugin-sandboxing.md`).
- **Lock acquisition:** advisory locks held by Resource Manager, one
  holder at a time per resource identifier; a second requester blocks
  (with a timeout, see below) rather than proceeding unsynchronized.
- **Race prevention:** every mutation to a shared entity goes through
  its owning component's API (`constraints.md`) — there is no direct
  shared-memory access between components, which is what makes most
  races structurally impossible rather than merely unlikely.

## Coalescing, debounce, and conflict windows

Two genuinely distinct windowing concepts are referenced vaguely as "a
short window" across multiple documents
(`docs/02-architecture/event-driven-architecture.md`,
docs/03-runtime/state-manager.md and docs/37-edge-cases/
duplicate-events.md`, and others) without a pinned duration anywhere.
Per this file's own stated purpose — an implementer should never have
to invent a number this document was supposed to supply — both are
fixed here:

- **Observer debounce window: 250ms.** The window
  `event-driven-architecture.md`'s Handling event storms flowchart uses
  to coalesce repeated raw OS events (same path + event type) from a
  *single* observer stream into one normalized event. Short, because
  it's deduplicating rapid-fire signals from one source, not correlating
  across sources.
- **Observer batch-size threshold: 50 events.** The threshold that same
  flowchart's "Batch size exceeds topic threshold?" branch checks before
  emitting a bulk-change event instead of individual normalized events.
- **Cross-observer conflict window: 5 seconds.** The window
  `state-manager.md`'s conflict-resolution logic and
  `duplicate-events.md`'s semantic deduplication use to decide whether
  reports from *different* observers (or a create/delete pair from the
  same observer) describe the same real-world event. Longer than the
  debounce window above because it accounts for cross-process/
  cross-observer propagation delay, not just OS-event coalescing
  latency.

Both are configurable overrides, not hardcoded constants — see
`docs/14-development/configuration-schema.md` — but these are the
shipped defaults an implementer builds and tests against absent an
explicit override.

## Retry policies

Default policy for any retryable operation, unless its own contract
states otherwise:

- **Max retries:** 3.
- **Backoff:** exponential, base 500ms, multiplier 2x (500ms, 1s, 2s).
- **Jitter:** ±20% randomized, to avoid synchronized retry storms across
  a workspace's components.
- **Timeout per attempt:** see Timeouts table below, by operation class.
- **Circuit breaker:** a three-state (`Closed` / `Open` / `HalfOpen`)
  breaker maintained per external dependency (a provider, a plugin, a
  remote service). This is the canonical definition — no other document
  defines a competing circuit-breaker state machine or numbers; any that
  appears to must be corrected to match this one:
  - **`Closed`** (default): calls pass through normally. A consecutive-
    failure counter increments on each failure and resets to 0 on any
    success.
  - **`Closed` → `Open`:** trips after **5 consecutive failures** to the
    same dependency. While `Open`, calls fail fast immediately rather
    than queuing or waiting out the per-attempt timeout — the caller
    receives the typed unavailable error without a network round trip.
    This maps the dependency's `health_status`
    (`docs/18-providers/provider-interface.md`) to **`down`**, not
    `degraded` — `Open` means no calls are getting through at all, which
    is the `down` case; `degraded` is reserved for the softer,
    breaker-independent signal of elevated latency/error-rate that has
    not yet crossed the 5-consecutive-failure trip threshold
    (`docs/25-failure-modes/FM-04-model-router-provider-fallback.md`'s
    FM-04-018).
  - **`Open` → `HalfOpen`:** after a **60-second cooldown**, the breaker
    admits exactly one trial call.
  - **`HalfOpen` → `Closed`:** the trial call succeeds; the
    consecutive-failure counter resets to 0 and `health_status` returns
    to `reachable` (or `degraded`, per that same live signal).
  - **`HalfOpen` → `Open`:** the trial call fails; the 60-second cooldown
    resets and `health_status` remains `down`.
  - While `Open` or `HalfOpen`, the provider is skipped in the fallback
    chain (`docs/18-providers/provider-routing.md`'s Fallback chains
    section) exactly as a `healthCheck()`-reported `down` provider would
    be — the breaker is what *produces* that `down` reading between
    real health-check polls, not a separate gate the router checks
    independently.
- **Non-idempotent operations:** never auto-retried by the system; the
  caller must supply an idempotency key (see
  `17-event-and-internal-api-contracts.md`) or explicitly re-confirm.

## Timeouts (default per operation class)

| Operation class | Default timeout |
|---|---|
| Internal API call (e.g., `createTask()`) | 5s |
| Planning (single planning pass) | 30s |
| Tool execution, native/internal | 15s |
| Tool execution, external API/MCP | 30s |
| Tool execution, CLI subprocess | 60s |
| Memory retrieval query | 2s |
| Indexing (single file) | 5s |
| Plugin capability call | 10s |
| Model/provider inference call | 60s (streaming: 60s to first token) |

A timeout is always a specific, configured value per operation class —
never an implicit "however long it takes." An operation with no
documented timeout is treated as a specification gap to fix, not as
"unbounded by design."

## Resource limits (default per workspace)

| Resource | Default limit |
|---|---|
| Memory (process working set) | Per `docs/39-performance-budgets/memory-usage.md` |
| Disk (workspace cache + index) | Per `docs/39-performance-budgets/budgets.md` |
| Concurrent threads (background work) | Per `docs/39-performance-budgets/cpu.md` |
| Concurrent network requests | 10 per provider, system-wide cap per `docs/39-performance-budgets/budgets.md` |
| Tokens (per single model call) | Per `docs/05-ai/model-routing-matrix.md`'s per-model context limits |
| Open files (Observer/Indexer) | OS default minus a reserved headroom, per `docs/07-observers/observer-framework.md` |
| Concurrent contexts / workspaces loaded | Per `docs/39-performance-budgets/memory-usage.md` |

Exceeding any limit above triggers graceful degradation (queue, reject
new work, or shed the lowest-priority task) — never an unbounded
allocation and never a hard crash; see
`18-failure-and-recovery-contracts.md`.

## Maintenance rule

Any operation introduced without an entry in the Timeouts or Resource
Limits tables above is treated as unspecified and must be given a
default here before being considered implementation-ready.

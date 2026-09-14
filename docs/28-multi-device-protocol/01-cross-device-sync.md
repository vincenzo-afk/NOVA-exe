# Cross-Device Synchronization

## Purpose

The full sync contract across a paired device set (Primary Runtime, Full
Peers, Companions — see `docs/20-devices/multi-device-architecture.md`),
extending `docs/20-devices/cross-device-memory.md`'s memory-specific sync
rules into a complete lifecycle: registration, trust, pairing, initial
sync, incremental sync, conflict resolution, offline sync, priority,
encryption, session handoff, device removal, and retry.

## Lifecycle

```
Device Registration
      ↓
Trust Establishment  ───────► 02-device-pairing-protocol.md
      ↓
Initial Sync (full snapshot pull)
      ↓
Incremental Sync (delta pull, ongoing)
      ↓
   ┌──┴──┐
   ▼     ▼
Conflict   Offline
Resolution  Sync
   │         │
   └────┬────┘
        ▼
Session Handoff  ───────► 03-session-continuity-and-handoff.md
        │
        ▼
Device Removal
```

## Device registration

A device is registered to a NOVA identity (`10-identity-and-workspace.md`)
before any sync traffic occurs. Registration records the device's public
key, declared capabilities (`04-presence-and-capabilities.md`), and
runtime mode (Full Peer / Companion, per `multi-device-architecture.md`).
Registration alone does not grant trust — see Trust Establishment below.

## Trust establishment & pairing

Full protocol detail is `02-device-pairing-protocol.md`. In summary: a
short-lived, user-confirmed channel (QR/local-network handshake)
exchanges keys; no device is trusted based on network presence alone.

## Initial sync

On first successful pairing, the new device performs a full pull of
every memory tier, knowledge-graph partition, and configuration scope it
has been granted access to (per the privacy-boundary rule in
`cross-device-memory.md`) — not an incremental sync, since there is no
prior checkpoint to diff against. Initial sync is chunked and resumable
(same integrity pattern as `08-file-transfer-and-media-streaming.md`) so
a large initial sync interrupted mid-transfer resumes rather than
restarting from zero.

## Incremental sync

After initial sync, each device periodically pulls changes since its
last sync checkpoint (a logical clock position, not a wall-clock
timestamp — see `14-time-and-version-compatibility.md`). Incremental
sync reuses the memory lineage/versioning conflict rules already
established in `docs/04-memory/memory-lineage.md`.

## Conflict resolution

Per `cross-device-memory.md`: last-write-wins per field with full history
retained via existing lineage fields, not a new conflict model
introduced specifically for multi-device. See `04-state-transition-tables.md`'s (in `docs/26-system-reference/`) Session table and
`docs/25-failure-modes/FM-10-018` for the general pattern this
specializes.

## Offline sync

Each device operates fully from its local replica while disconnected;
nothing about sync makes local operation dependent on reachability of
other devices. On reconnect, sync resumes from the last valid checkpoint
automatically, with exponential backoff if the resumed sync itself fails
repeatedly (same backoff discipline as `docs/03-runtime/runtime-manager.md`'s restart policy).

## Sync priority

When multiple sync-eligible changes are pending, priority order is:
security-relevant state (permission/trust changes) → in-flight task
state (visibility, not execution — execution stays on the originating
device) → conversation/episodic memory → knowledge-graph updates →
device-local config (which, per `cross-device-memory.md`, doesn't sync
by default at all).

## Encryption

End-to-end: the sync endpoint (self-hosted or user-controlled storage)
never has plaintext access, per `cross-device-memory.md`'s sync model and
`docs/10-security/encryption.md`.

## Session handoff

See `03-session-continuity-and-handoff.md` for full detail.

## Device removal

Removing a device revokes its pairing key immediately (does not require
the removed device to be online), per the same immediate-effect
revocation principle as `docs/20-devices/remote-control.md`'s
revocation rule. The removed device's local replica is not remotely
wiped by default (NOVA does not assume it can reach a removed device);
if remote wipe is desired, it is a separate, explicitly-requested action
distinct from removal itself.

## Sync retry

A failed sync attempt retries with exponential backoff, capped, per the
same idempotency discipline as `docs/03-runtime/failure-recovery.md` —
sync operations are designed to be idempotent (re-pulling the same delta
twice produces the same end state), so blind retry is safe here in a way
it would not be for a non-idempotent action.

## Related documents

- `docs/20-devices/multi-device-architecture.md` — topology and pairing basis
- `docs/20-devices/cross-device-memory.md` — the memory-specific sync
  rules this document extends to the full lifecycle
- `docs/04-memory/memory-lineage.md`, `memory-versioning.md` — conflict rules reused
- `02-device-pairing-protocol.md`, `03-session-continuity-and-handoff.md`

## Implementation

`services/runtime/src/cross-device-sync.ts` (`CrossDeviceSyncManager`)
implements this document's last-write-wins, field-level, category-
prioritized merge logic against an injected `SyncTransport` — until
now only exercised by test doubles. `services/runtime/src/companion-sync-store.ts`
is the first real transport: an append-only encrypted-envelope log per
paired device (`CompanionSyncBroker`) plus a `SyncTransport` factory
wired to it, and `companion-server.ts` exposes it over
`/v1/companion/sync/pull` and `/sync/push`. `apps/android-companion/.../DeviceSyncClient.kt`
is a Kotlin mirror of `CrossDeviceSyncManager` (same merge algorithm,
independently implemented) that talks to those endpoints, encrypting
every payload with the AES-256-GCM key derived at pairing
(`companion-crypto.ts` / `CompanionCrypto.kt`).

## Where This Breaks

Failure modes specific to this protocol area. Cross-referenced from `docs/25-failure-modes/FM-26-multi-device-protocol.md`, which indexes all multi-device failure entries in one place, and from `FM-10-desktop-android-distributed-sync.md` for the general distributed-systems failure classes this protocol area instantiates.

| ID | Failure | Trigger | Detection | Severity | Mitigation | Recovery |
|---|---|---|---|---|---|---|
| **FM-26-001** | Initial sync of a large memory corpus fails repeatedly on unreliable networks | Companion device on cellular/weak wifi can't complete a large chunked transfer before some other interruption. | Resumable-transfer checkpoint never advances across multiple attempts. | Medium | Make initial-sync chunk size adaptive to observed link quality, and persist resumption state durably so partial progress is never lost between attempts. | Fall back to a smaller chunk size automatically after repeated failures at the current size; surface progress percentage to the user rather than appearing hung. |
| **FM-26-002** | Sync priority ordering starves low-priority categories indefinitely on a chronically-degraded link | Same starvation pattern as `docs/25-failure-modes/FM-02-012`, applied to sync categories instead of task queue priority. | Device-local config or knowledge-graph sync lag grows unbounded relative to higher-priority categories. | Low | Apply the same aging-based priority boost from `FM-02-012` to sync categories, not just the task queue. | Force-sync the oldest-starved category ahead of a same-tier newer change once its age crosses a threshold. |
| **FM-26-003** | Device removal doesn't propagate before the removed device attempts one more sync | Race between the removal action and an in-flight sync from the device being removed. | Sync from a just-removed device is accepted because key revocation hadn't yet taken effect at the sync endpoint. | Medium | Revoke at the sync endpoint (not just locally) as the first step of removal, before any other removal bookkeeping, so no window exists where the old key still works. | Reject and roll back any sync accepted from a device after its removal timestamp; audit for what that device may have already received before removal. |
| **FM-26-004** | See also `docs/25-failure-modes/FM-10-016` through `023` | Network partition, split-brain, conflicting updates, duplicate execution, lost synchronization, clock skew, partial replication, and eventual-consistency violations are the general distributed-systems failure classes this whole sync lifecycle instantiates. | See `FM-10-desktop-android-distributed-sync.md`. | — | See FM-10. | See FM-10. |

import { err, ok, type Result } from "@nova/shared";

import type { ExecutionStep } from "./orchestration.js";

/**
 * Turns a flat `ExecutionStep[]` (optionally carrying `depends_on`
 * edges) into an ordered list of groups, where every step within one
 * group is safe to run concurrently via `Promise.all` — closing the
 * "no parallel steps" half of the replanning-loop gap
 * (`docs/references/feature-gap-analysis.md` §9,
 * `runtime-task-coordinator.ts`'s previous strictly-sequential loop).
 *
 * Two steps land in the same group only when both hold:
 * 1. **Dependency-safe** — every `depends_on` id either step names is
 *    already satisfied by an earlier group, so a step never starts
 *    before something it explicitly depends on has finished.
 * 2. **Lock-safe** — the two steps' `required_locks` don't overlap.
 *    `ResourceManager.acquire()` (`orchestration.ts`'s `Executor`)
 *    rejects a lock conflict outright rather than queuing and
 *    waiting for it, so two lock-conflicting steps run concurrently
 *    would mean one of them fails immediately for a reason that has
 *    nothing to do with the step itself — this scheduler prevents
 *    that combination from ever being attempted, rather than relying
 *    on the resource layer to handle it gracefully.
 *
 * A step with no `depends_on` at all runs in the earliest group its
 * lock set allows — this is what actually recovers parallelism for a
 * plan where nothing declares explicit dependencies, not just for
 * plans that opt into the field.
 */

export function computeExecutionGroups(
  steps: readonly ExecutionStep[],
): Result<readonly (readonly ExecutionStep[])[]> {
  if (steps.length === 0) return ok([]);

  const byId = new Map<string, ExecutionStep>();
  for (const step of steps) {
    if (byId.has(step.step_id)) {
      return err({
        code: "NOVA-TL003",
        message: `Duplicate step_id '${step.step_id}' in the same plan.`,
        retryable: false,
      });
    }
    byId.set(step.step_id, step);
  }
  for (const step of steps) {
    for (const dependencyId of step.depends_on ?? []) {
      if (!byId.has(dependencyId)) {
        return err({
          code: "NOVA-TL003",
          message: `Step '${step.step_id}' depends_on unknown step_id '${dependencyId}'.`,
          retryable: false,
        });
      }
      if (dependencyId === step.step_id) {
        return err({
          code: "NOVA-TL003",
          message: `Step '${step.step_id}' cannot depend on itself.`,
          retryable: false,
        });
      }
    }
  }

  const remainingDependencies = new Map<string, Set<string>>();
  const dependents = new Map<string, string[]>();
  for (const step of steps) {
    remainingDependencies.set(step.step_id, new Set(step.depends_on ?? []));
  }
  for (const step of steps) {
    for (const dependencyId of step.depends_on ?? []) {
      const existing = dependents.get(dependencyId) ?? [];
      existing.push(step.step_id);
      dependents.set(dependencyId, existing);
    }
  }

  const groups: ExecutionStep[][] = [];
  let ready = steps.filter((step) => remainingDependencies.get(step.step_id)!.size === 0);
  const scheduled = new Set<string>();

  while (ready.length > 0) {
    const group: ExecutionStep[] = [];
    const lockedInGroup = new Set<string>();
    const deferred: ExecutionStep[] = [];

    for (const candidate of ready) {
      const conflicts = candidate.required_locks.some((lock) => lockedInGroup.has(lock));
      if (conflicts) {
        deferred.push(candidate);
        continue;
      }
      group.push(candidate);
      for (const lock of candidate.required_locks) lockedInGroup.add(lock);
    }

    // Every candidate conflicted with something already placed this round —
    // this can only happen if `ready` itself was empty going in, which the
    // while-loop guard already excludes, so `group` is always non-empty here.
    groups.push(group);
    for (const step of group) scheduled.add(step.step_id);

    const nextReady: ExecutionStep[] = [...deferred];
    for (const step of group) {
      for (const dependentId of dependents.get(step.step_id) ?? []) {
        const remaining = remainingDependencies.get(dependentId)!;
        remaining.delete(step.step_id);
        if (remaining.size === 0) nextReady.push(byId.get(dependentId)!);
      }
    }
    ready = nextReady;
  }

  if (scheduled.size !== steps.length) {
    const unresolved = steps.filter((step) => !scheduled.has(step.step_id)).map((step) => step.step_id);
    return err({
      code: "NOVA-TL003",
      message: `Plan has a dependency cycle involving step(s): ${unresolved.join(", ")}.`,
      retryable: false,
    });
  }

  return ok(groups);
}

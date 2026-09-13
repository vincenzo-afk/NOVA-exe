import {
  err,
  ok,
  windowPolicy,
  type Result,
  type StateObservation,
  type StateQuery,
  type StateResolution,
} from "@nova/shared";

const observationShape = {
  entityRef: "entityRef",
  value: "value",
  observer: "observer",
  observedAt: "observedAt",
  confidence: "confidence",
  corroborated: "corroborated",
} as const;

type ActiveRecheck<TValue> = (entityRef: string) => Promise<TValue>;

export class StateManager<TValue = unknown> {
  private readonly observations = new Map<string, StateObservation<TValue>[]>();

  constructor(private readonly activeRecheck?: ActiveRecheck<TValue>) {}

  observe(observation: StateObservation<TValue>): Result<void> {
    if (
      observation.entityRef.length === 0 ||
      observation.observer.length === 0 ||
      !Number.isFinite(observation.confidence) ||
      observation.confidence < 0 ||
      observation.confidence > 1 ||
      Number.isNaN(Date.parse(observation.observedAt))
    ) {
      return err({
        code: "NOVA-CFG001",
        message: "Observation failed State Manager validation.",
        retryable: false,
        details: { invalidField: observationShape.confidence },
      });
    }

    const existing = this.observations.get(observation.entityRef) ?? [];
    existing.push(observation);
    existing.sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt));
    this.observations.set(observation.entityRef, existing);
    return ok(undefined);
  }

  async query(query: StateQuery): Promise<Result<StateResolution<TValue>>> {
    const entityObservations = this.observations.get(query.entityRef);
    const latest = entityObservations?.at(-1);
    if (!latest || !entityObservations) {
      return err({
        code: "NOVA-CFG001",
        message: `No observation exists for entity ${query.entityRef}.`,
        retryable: false,
        details: { entityRef: query.entityRef },
      });
    }

    const contradictionPending = entityObservations.some((candidate) => {
      if (candidate === latest || candidate.observer === latest.observer) {
        return false;
      }
      const ageMs = Math.abs(Date.parse(latest.observedAt) - Date.parse(candidate.observedAt));
      return (
        ageMs <= windowPolicy.crossObserverConflictMs &&
        !Object.is(candidate.value, latest.value) &&
        JSON.stringify(candidate.value) !== JSON.stringify(latest.value)
      );
    });

    if (contradictionPending && query.allowActiveRecheck && this.activeRecheck) {
      const value = await this.activeRecheck(query.entityRef);
      // The active recheck is a fresh, authoritative, on-demand OS
      // query (docs/03-runtime/state-manager.md's "Active re-check"
      // section) — it must be recorded as a new observation, not just
      // returned once and forgotten. Without this, the very next
      // query() call for this entity would recompute
      // contradictionPending from the same stale, still-conflicting
      // observations and see a contradiction again — defeating the
      // "used sparingly" resource-cost rationale that section gives
      // for not re-checking on every query. Confidence 1: a direct
      // on-demand check is by definition the most authoritative signal
      // available, not bound to whichever prior observation happened
      // to be `latest`.
      const recheckObservation: StateObservation<TValue> = {
        entityRef: query.entityRef,
        value,
        observer: "active_recheck",
        observedAt: new Date().toISOString(),
        confidence: 1,
        corroborated: false,
      };
      this.observe(recheckObservation);
      return ok({
        value,
        confidence: recheckObservation.confidence,
        resolvedAt: recheckObservation.observedAt,
        contradictionPending: false,
      });
    }

    return ok({
      value: latest.value,
      confidence: latest.confidence,
      resolvedAt: new Date().toISOString(),
      contradictionPending,
    });
  }
}

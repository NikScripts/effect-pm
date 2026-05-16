/**
 * Runtime state and fact vocabulary shared by processes, queues, resources, and
 * groups.
 *
 * @remarks
 * This module is intentionally small. Runtime components can publish facts or
 * state changes when they mutate, while storage/projection layers can subscribe
 * without forcing feature-specific methods onto `ProcessStore`.
 *
 * @module RuntimeState
 */

import { Context, Effect, Layer, Option } from "effect";
import { ProcessStore, type RuntimeFactRecordedEvent } from "./ProcessStore";

/**
 * Stable identity for a runtime component.
 *
 * @public
 */
export interface RuntimeRef<out Kind extends string = string> {
  readonly kind: Kind;
  readonly id: string;
}

/**
 * Base shape for live state snapshots owned by a runtime component.
 *
 * @public
 */
export interface RuntimeStateBase {
  readonly ref: RuntimeRef;
  readonly observedAt: number;
  readonly configVersion: number;
}

/**
 * History record for a state transition.
 *
 * @public
 */
export interface RuntimeStateChange<out State extends RuntimeStateBase = RuntimeStateBase> {
  readonly id: string;
  readonly ref: RuntimeRef;
  readonly changedAt: number;
  readonly reason: string;
  readonly previous: State | null;
  readonly current: State;
}

/**
 * Discrete runtime occurrence that is not necessarily a full state snapshot.
 *
 * @public
 */
export interface RuntimeFact<out Payload = unknown> {
  readonly id: string;
  readonly ref: RuntimeRef;
  readonly type: string;
  readonly occurredAt: number;
  readonly payload: Payload;
  readonly attributes?: Record<string, unknown>;
}

/**
 * Optional observer service for runtime facts and state changes.
 *
 * @public
 */
export interface RuntimeObserverService {
  readonly publishStateChange: (
    change: RuntimeStateChange,
  ) => Effect.Effect<void>;
  readonly publishFact: (fact: RuntimeFact) => Effect.Effect<void>;
}

/**
 * Optional runtime observation sink.
 *
 * @remarks
 * Runtime modules use `Effect.serviceOption(RuntimeObserver)` so observation is
 * best-effort and never required by default.
 *
 * @public
 */
export class RuntimeObserver extends Context.Service<
  RuntimeObserver,
  RuntimeObserverService
>()("@nikscripts/effect-pm/RuntimeState/RuntimeObserver") {}

export namespace RuntimeObserver {
  const factToAnalyticsEvent = (fact: RuntimeFact): RuntimeFactRecordedEvent => ({
    id: `runtime.fact/${fact.id}`,
    type: "runtime.fact.recorded",
    occurredAt: fact.occurredAt,
    entityType: fact.ref.kind,
    entityId: fact.ref.id,
    attributes: fact.attributes,
    fact,
  });

  /**
   * Publish a state change if a {@link RuntimeObserver} is present.
   *
   * @public
   */
  export const publishStateChange = (
    change: RuntimeStateChange,
  ): Effect.Effect<void> =>
    Effect.flatMap(
      Effect.serviceOption(RuntimeObserver),
      Option.match({
        onNone: () => Effect.void,
        onSome: (observer) => observer.publishStateChange(change).pipe(Effect.ignore),
      }),
    );

  /**
   * Publish a fact if a {@link RuntimeObserver} is present.
   *
   * @public
   */
  export const publishFact = (fact: RuntimeFact): Effect.Effect<void> =>
    Effect.flatMap(
      Effect.serviceOption(RuntimeObserver),
      Option.match({
        onNone: () => Effect.void,
        onSome: (observer) => observer.publishFact(fact).pipe(Effect.ignore),
      }),
    );

  /**
   * Observer layer that persists runtime facts through the current
   * {@link ProcessStore} analytics event envelope.
   *
   * @remarks
   * State changes intentionally no-op here until the generic state-history
   * storage shape lands. Facts are persisted as `runtime.fact.recorded` events.
   *
   * @public
   */
  export const layerProcessStore: Layer.Layer<RuntimeObserver, never, ProcessStore> =
    Layer.effect(
      RuntimeObserver,
      Effect.map(ProcessStore, (store): RuntimeObserverService => ({
        publishStateChange: () => Effect.void,
        publishFact: (fact) => store.append(factToAnalyticsEvent(fact)),
      })),
    );
}

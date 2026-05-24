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

import { Cause, Context, Effect, Layer, Option } from "effect";
import {
  ProcessStore,
  type RuntimeFactRecordedEvent,
  type RuntimeStateChangedEvent,
} from "./ProcessStore";

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
 * Listener hooks for runtime observations.
 *
 * @remarks
 * Listener failures are isolated by {@link RuntimeObserver.layerListeners}; a
 * failed listener must not fail the runtime mutation that published the
 * observation.
 *
 * @public
 */
export interface RuntimeObserverListener {
  readonly onStateChange?: (
    change: RuntimeStateChange,
  ) => Effect.Effect<void, unknown>;
  readonly onFact?: (fact: RuntimeFact) => Effect.Effect<void, unknown>;
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
  const notifyListeners = (
    listeners: ReadonlyArray<RuntimeObserverListener>,
    select: (listener: RuntimeObserverListener) => Effect.Effect<void, unknown> | undefined,
  ): Effect.Effect<void> =>
    Effect.forEach(
      listeners,
      (listener) => {
        const effect = select(listener);
        return effect === undefined ? Effect.void : effect.pipe(Effect.ignore);
      },
      { discard: true },
    );

  const factToAnalyticsEvent = (fact: RuntimeFact): RuntimeFactRecordedEvent => ({
    id: `runtime.fact/${fact.id}`,
    type: "runtime.fact.recorded",
    occurredAt: fact.occurredAt,
    entityType: fact.ref.kind,
    entityId: fact.ref.id,
    attributes: fact.attributes,
    fact,
  });

  const stateChangeToAnalyticsEvent = (
    change: RuntimeStateChange,
  ): RuntimeStateChangedEvent => ({
    id: `runtime.state/${change.id}`,
    type: "runtime.state.changed",
    occurredAt: change.changedAt,
    entityType: change.ref.kind,
    entityId: change.ref.id,
    change,
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
   * Observer layer that persists facts and state changes through an existing
   * {@link ProcessStore}. Not the same symbol as sqlite {@link layerProcessStore}
   * on `@nikscripts/effect-pm/storage/sqlite`.
   *
   * @remarks
   * Facts are persisted as `runtime.fact.recorded` events, and state changes are
   * persisted as `runtime.state.changed` events.
   *
   * @public
   */
  export const layerFromProcessStore: Layer.Layer<RuntimeObserver, never, ProcessStore> =
    Layer.effect(
      RuntimeObserver,
      Effect.gen(function* () {
        const store = yield* ProcessStore;
        const appendObservation = (event: RuntimeFactRecordedEvent | RuntimeStateChangedEvent) =>
          store.append(event).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("ProcessStore write failed for runtime observation").pipe(
                Effect.annotateLogs("cause", Cause.pretty(cause)),
              )
            ),
          );
        return {
          publishStateChange: (change) => appendObservation(stateChangeToAnalyticsEvent(change)),
          publishFact: (fact) => appendObservation(factToAnalyticsEvent(fact)),
        };
      }),
    );

  /**
   * @deprecated Use {@link layerFromProcessStore}. Kept for compatibility; name
   * collided with sqlite `layerProcessStore`.
   *
   * @public
   */
  export const layerProcessStore: Layer.Layer<RuntimeObserver, never, ProcessStore> =
    layerFromProcessStore;

  /**
   * Observer layer that forwards facts and state changes to scoped listeners.
   *
   * @remarks
   * The listeners are captured when the layer is built. Listener failures are
   * ignored so observation never changes the runtime effect's success or error
   * channel. This layer does not persist observations.
   *
   * @public
   */
  export const layerListeners = (
    listeners: ReadonlyArray<RuntimeObserverListener>,
  ): Layer.Layer<RuntimeObserver> =>
    Layer.effect(
      RuntimeObserver,
      Effect.sync(() => {
        const scopedListeners = [...listeners];
        return {
          publishStateChange: (change) =>
            notifyListeners(scopedListeners, (listener) =>
              listener.onStateChange?.(change)
            ),
          publishFact: (fact) =>
            notifyListeners(scopedListeners, (listener) =>
              listener.onFact?.(fact)
            ),
        };
      }),
    );
}

/**
 * Runtime state and fact vocabulary shared by processes, queues, resources, and
 * groups.
 *
 * @remarks
 * This module is intentionally small. Runtime components can publish facts or
 * state changes when they mutate, while storage/projection layers can subscribe
 * without forcing feature-specific methods onto a monolithic store.
 *
 * For durable history, compose {@link RuntimeObserver.layer} with
 * {@link ProcessStoreRuntime.layerRuntimeStorage} (or `ProcessStore.layerRuntimeStorage` /
 * `layerProcessStore` from `@nikscripts/effect-pm/storage/sqlite`) at app or
 * group-child scope — not inside feature modules.
 *
 * @module RuntimeState
 */

import { Context, Effect, Layer, Option } from "effect";
import {
  ProcessStoreRuntime,
  persistRuntimeObservation,
} from "./ProcessStoreRuntime";

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

  /**
   * Publish a state change if a {@link RuntimeObserver} is present.
   *
   * @remarks
   * Observer and persistence failures are ignored so the publishing runtime
   * mutation keeps its original success/error channel.
   *
   * @public
   */
  export const publishStateChange = (
    change: RuntimeStateChange,
  ): Effect.Effect<void> =>
    Effect.serviceOption(RuntimeObserver).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.void,
          onSome: (observer) => observer.publishStateChange(change),
        }),
      ),
      Effect.ignore,
    );

  /**
   * Publish a fact if a {@link RuntimeObserver} is present.
   *
   * @remarks
   * Observer and persistence failures are ignored so the publishing runtime
   * mutation keeps its original success/error channel.
   *
   * @public
   */
  export const publishFact = (fact: RuntimeFact): Effect.Effect<void> =>
    Effect.serviceOption(RuntimeObserver).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.void,
          onSome: (observer) => observer.publishFact(fact),
        }),
      ),
      Effect.ignore,
    );

  /**
   * Observer layer that persists facts and state changes through
   * {@link ProcessStoreRuntime}.
   *
   * @remarks
   * Not the same symbol as sqlite `layerProcessStore` on
   * `@nikscripts/effect-pm/storage/sqlite`.
   *
   * @public
   */
  export const layer: Layer.Layer<RuntimeObserver, never, ProcessStoreRuntime> =
    Layer.effect(
      RuntimeObserver,
      ProcessStoreRuntime.pipe(
        Effect.map((runtime) => ({
          publishStateChange: (change) =>
            persistRuntimeObservation(runtime.recordStateChange(change)),
          publishFact: (fact) =>
            persistRuntimeObservation(runtime.recordFact(fact)),
        })),
      ),
    );

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

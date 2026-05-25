/**
 * @module examples/forms/resource/run-resource-runtime-observer
 *
 * `RunResource` facts and state changes through `ProcessStoreRunResource`.
 *
 * - **In-process:** provide a custom `ProcessStoreRunResource`-shaped
 *   service whose record methods fan out to scoped callbacks. The static
 *   emitters used by `RunResource.make` wrap each call with a built-in
 *   `catchCause + logWarning` so a listener that fails cannot change the
 *   gated effect's success/error channel. A planned future feature
 *   (`ProcessStoreRunResource.live(resourceId)`) will replace this with a
 *   proper `Stream` subscription.
 * - **Durable:** compose `layerProcessStore` at app scope (see the
 *   {@link RunResource} module doc).
 *
 * Run: `npx tsx examples/forms/resource/run-resource-runtime-observer.ts`
 */

import { Effect, Layer, Option, Ref } from "effect";
import {
  ProcessStoreRunResource,
  RunResource,
  type RunResourceFact,
  type RunResourceState,
  type RunResourceStateChange,
} from "../../../src";

interface RunResourceObservationListener {
  readonly onFact?: (fact: RunResourceFact) => Effect.Effect<void, unknown>;
  readonly onStateChange?: (
    change: RunResourceStateChange,
  ) => Effect.Effect<void, unknown>;
}

const observerFacet = (
  listeners: ReadonlyArray<RunResourceObservationListener>,
): ProcessStoreRunResource.Type => {
  const fanFact = (fact: RunResourceFact): Effect.Effect<void> =>
    Effect.forEach(
      listeners,
      (listener) =>
        listener.onFact === undefined
          ? Effect.void
          : listener.onFact(fact).pipe(Effect.ignore),
      { discard: true },
    );
  const fanState = (change: RunResourceStateChange): Effect.Effect<void> =>
    Effect.forEach(
      listeners,
      (listener) =>
        listener.onStateChange === undefined
          ? Effect.void
          : listener.onStateChange(change).pipe(Effect.ignore),
      { discard: true },
    );
  return {
    recordRunStarted: fanFact,
    recordRunCompleted: fanFact,
    recordRunFailed: fanFact,
    recordStateChange: fanState,
    recordFactBatch: (facts) =>
      Effect.forEach(facts, fanFact, { discard: true }),
    recordStateChangeBatch: (changes) =>
      Effect.forEach(changes, fanState, { discard: true }),
    facts: () => Effect.succeed([]),
    stateHistory: () => Effect.succeed([]),
    latestState: () => Effect.succeed(Option.none()),
    runs: () => Effect.succeed([]),
    byRun: () => Effect.succeed([]),
  };
};

const program = Effect.gen(function* () {
  const factTypes = yield* Ref.make<ReadonlyArray<string>>([]);
  const stateReasons = yield* Ref.make<ReadonlyArray<string>>([]);
  const stateChanges = yield* Ref.make<ReadonlyArray<RunResourceStateChange>>([]);

  const factListener: RunResourceObservationListener = {
    onFact: (fact) => Ref.update(factTypes, (items) => [...items, fact.type]),
  };

  const stateListener: RunResourceObservationListener = {
    onStateChange: (change) =>
      Effect.all(
        [
          Ref.update(stateReasons, (items) => [...items, change.reason]),
          Ref.update(stateChanges, (items) => [...items, change]),
        ],
        { discard: true },
      ),
  };

  const failingListener: RunResourceObservationListener = {
    onFact: () => Effect.fail("listener failure is isolated"),
  };

  const observerLayer = Layer.succeed(
    ProcessStoreRunResource,
    observerFacet([factListener, stateListener, failingListener]),
  );

  yield* Effect.gen(function* () {
    const gate = yield* RunResource.make({
      name: "examples/ObservedRunGate",
      effect: (n: number) =>
        n >= 0 ? Effect.succeed(n + 1) : Effect.fail("negative input"),
      concurrency: 1,
    });

    yield* gate(1);
    yield* gate(-1).pipe(Effect.flip);

    const observedFactTypes = yield* Ref.get(factTypes);
    const observedStateReasons = yield* Ref.get(stateReasons);
    const observedChanges = yield* Ref.get(stateChanges);
    const latestState: RunResourceState | undefined =
      observedChanges.at(-1)?.current ?? undefined;

    yield* Effect.log(`fact types: ${observedFactTypes.join(", ")}`);
    yield* Effect.log(`state reasons: ${observedStateReasons.join(", ")}`);
    yield* Effect.log(
      latestState === undefined
        ? "latest state: missing"
        : `latest state: completed=${String(latestState.completed)}, failed=${String(latestState.failed)}, inFlight=${String(latestState.inFlight)}`,
    );
  }).pipe(Effect.provide(observerLayer));

  // Observation is optional. Without ProcessStoreRunResource the static
  // emitters no-op and the gated effect behavior is unchanged.
  const unobservedGate = yield* RunResource.make({
    name: "examples/UnobservedRunGate",
    effect: (n: number) => Effect.succeed(n * 2),
  });
  const value = yield* unobservedGate(21);
  yield* Effect.log(`unobserved result: ${String(value)}`);
}).pipe(Effect.scoped);

void Effect.runPromise(program);

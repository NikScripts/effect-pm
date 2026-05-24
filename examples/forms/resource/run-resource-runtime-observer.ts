/**
 * @module examples/forms/resource/run-resource-runtime-observer
 *
 * RunResource runtime facts and state changes through RuntimeObserver.
 *
 * - **In-process:** `RuntimeObserver.layerListeners` (this script).
 * - **Durable:** compose `layerProcessStore` + `RuntimeObserver.layer`
 *   at app scope (see {@link RunResource} module doc).
 *
 * Run: `npx tsx examples/forms/resource/run-resource-runtime-observer.ts`
 */

import { Effect, Ref } from "effect";
import {
  RunResource,
  RuntimeObserver,
  type RuntimeObserverListener,
  type RunResourceState,
  type RuntimeStateBase,
  type RuntimeStateChange,
} from "../../../src";

const isRunResourceState = (
  state: RuntimeStateBase,
): state is RunResourceState => state.ref.kind === "run-resource";

const program = Effect.gen(function* () {
  const factTypes = yield* Ref.make<ReadonlyArray<string>>([]);
  const stateReasons = yield* Ref.make<ReadonlyArray<string>>([]);
  const stateChanges = yield* Ref.make<ReadonlyArray<RuntimeStateChange>>([]);

  const factListener: RuntimeObserverListener = {
    onFact: (fact) => Ref.update(factTypes, (items) => [...items, fact.type]),
  };

  const stateListener: RuntimeObserverListener = {
    onStateChange: (change) =>
      Effect.all(
        [
          Ref.update(stateReasons, (items) => [...items, change.reason]),
          Ref.update(stateChanges, (items) => [...items, change]),
        ],
        { discard: true },
      ),
  };

  // Listener failures are ignored by RuntimeObserver.layerListeners so
  // observation cannot change the gated effect success/error channel.
  const failingListener: RuntimeObserverListener = {
    onFact: () => Effect.fail("listener failure is isolated"),
  };

  const observerLayer = RuntimeObserver.layerListeners([
    factListener,
    stateListener,
    failingListener,
  ]);

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
    const runStates = observedChanges
      .map((change) => change.current)
      .filter(isRunResourceState);
    const latestState = runStates.at(-1);

    yield* Effect.log(
      `fact types: ${observedFactTypes.join(", ")}`,
    );
    yield* Effect.log(
      `state reasons: ${observedStateReasons.join(", ")}`,
    );
    yield* Effect.log(
      latestState === undefined
        ? "latest state: missing"
        : `latest state: completed=${String(latestState.completed)}, failed=${String(latestState.failed)}, inFlight=${String(latestState.inFlight)}`,
    );
  }).pipe(Effect.provide(observerLayer));

  // Observation is optional. Without RuntimeObserver, publish helpers no-op and
  // the gated effect behavior is unchanged.
  const unobservedGate = yield* RunResource.make({
    name: "examples/UnobservedRunGate",
    effect: (n: number) => Effect.succeed(n * 2),
  });
  const value = yield* unobservedGate(21);
  yield* Effect.log(`unobserved result: ${String(value)}`);
}).pipe(Effect.scoped);

void Effect.runPromise(program);

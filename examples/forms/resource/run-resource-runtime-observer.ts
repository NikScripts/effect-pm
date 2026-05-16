/**
 * @module examples/forms/resource/run-resource-runtime-observer
 *
 * RunResource runtime facts and state changes through RuntimeObserver.
 * Run: `npx tsx examples/forms/resource/run-resource-runtime-observer.ts`
 */

import { Effect, Ref } from "effect";
import {
  RunResource,
  RuntimeObserver,
  type RunResourceState,
  type RuntimeFact,
  type RuntimeStateBase,
  type RuntimeStateChange,
} from "../../../src";

const isRunResourceState = (
  state: RuntimeStateBase,
): state is RunResourceState => state.ref.kind === "run-resource";

const program = Effect.gen(function* () {
  const facts = yield* Ref.make<ReadonlyArray<RuntimeFact>>([]);
  const stateChanges = yield* Ref.make<ReadonlyArray<RuntimeStateChange>>([]);

  const observer = {
    publishFact: (fact: RuntimeFact) =>
      Ref.update(facts, (items) => [...items, fact]),
    publishStateChange: (change: RuntimeStateChange) =>
      Ref.update(stateChanges, (items) => [...items, change]),
  };

  yield* Effect.gen(function* () {
    const gate = yield* RunResource.make({
      name: "examples/ObservedRunGate",
      effect: (n: number) =>
        n >= 0 ? Effect.succeed(n + 1) : Effect.fail("negative input"),
      concurrency: 1,
    });

    yield* gate(1);
    yield* gate(-1).pipe(Effect.flip);

    const observedFacts = yield* Ref.get(facts);
    const observedChanges = yield* Ref.get(stateChanges);
    const runStates = observedChanges.map((change) => change.current).filter(isRunResourceState);
    const latestState = runStates.at(-1);

    yield* Effect.log(
      `fact types: ${observedFacts.map((fact) => fact.type).join(", ")}`,
    );
    yield* Effect.log(
      `state reasons: ${observedChanges.map((change) => change.reason).join(", ")}`,
    );
    yield* Effect.log(
      latestState === undefined
        ? "latest state: missing"
        : `latest state: completed=${String(latestState.completed)}, failed=${String(latestState.failed)}, inFlight=${String(latestState.inFlight)}`,
    );
  }).pipe(Effect.provideService(RuntimeObserver, observer));

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

/**
 * @module examples/forms/resource/run-resource-runtime-observer
 *
 * Query `RunResource` facts and state changes through `RunResourceStore`.
 *
 * Run: `npx tsx examples/forms/resource/run-resource-runtime-observer.ts`
 */

import { Effect } from "effect";
import {
  processStorageWithRunResourceArchiveLayer,
  RunResource,
  RunResourceStore,
  type RunResourceState,
} from "../../../src";

const program = Effect.gen(function* () {
  const gate = yield* RunResource.make({
    name: "examples/ObservedRunGate",
    effect: (n: number) =>
      n >= 0 ? Effect.succeed(n + 1) : Effect.fail("negative input"),
    concurrency: 1,
  });

  yield* gate(1);
  yield* gate(-1).pipe(Effect.flip);

  const runs = yield* RunResourceStore;
  const facts = yield* runs.facts({
    resourceId: "examples/ObservedRunGate",
  });
  const stateHistory = yield* runs.stateHistory({
    resourceId: "examples/ObservedRunGate",
  });
  const latestState: RunResourceState | undefined =
    stateHistory.at(-1)?.current ?? undefined;

  yield* Effect.log(`fact types: ${facts.map((fact) => fact.type).join(", ")}`);
  yield* Effect.log(
    `state reasons: ${stateHistory.map((change) => change.reason).join(", ")}`,
  );
  yield* Effect.log(
    latestState === undefined
      ? "latest state: missing"
      : `latest state: completed=${String(latestState.completed)}, failed=${String(latestState.failed)}, inFlight=${String(latestState.inFlight)}`,
  );
}).pipe(
  Effect.provide(processStorageWithRunResourceArchiveLayer),
  Effect.scoped,
);

void Effect.runPromise(program);

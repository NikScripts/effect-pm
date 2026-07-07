/**
 * @module examples/forms/resource/run-resource-runtime-observer
 *
 * Live observation on {@link RunResource.Service} handles via {@link Subscribable}
 * views (`status`, `waiting`, `completed`, …).
 *
 * Run: `npx tsx examples/forms/resource/run-resource-runtime-observer.ts`
 */

import { Effect, Layer, Ref, Schema, Stream } from "effect";
import { RunResource, Store } from "../../../src";

const ObservedRunGate = RunResource.Service<{ readonly _tag: "ObservedRunGate" }>()(
  "examples/ObservedRunGate",
  {
    payload: Schema.Number,
    success: Schema.Number,
    error: Schema.String,
    effect: (n: number) =>
      n >= 0 ? Effect.succeed(n + 1) : Effect.fail("negative input"),
    concurrency: 1,
  },
);

const program = Effect.gen(function* () {
  yield* Effect.gen(function* () {
    const gate = yield* ObservedRunGate;
    const completedSamples = yield* Ref.make<ReadonlyArray<number>>([]);

    yield* Stream.runForEach(gate.completed.changes, (n) =>
      Ref.update(completedSamples, (items) => [...items, n]),
    ).pipe(
      Effect.forkScoped,
      Effect.flatMap(() =>
        Effect.gen(function* () {
          yield* gate.run(1);
          yield* gate.run(-1).pipe(Effect.flip);
          yield* ObservedRunGate.run(2);

          const samples = yield* Ref.get(completedSamples);
          const status = yield* gate.status.get;

          yield* Effect.log(`completed.changes samples: ${samples.join(", ")}`);
          yield* Effect.log(
            `status: completed=${String(status.completed)}, failed=${String(status.failed)}, waiting=${String(status.waiting)}, inFlight=${String(status.inFlight)}`,
          );
        }),
      ),
    );
  }).pipe(
    Effect.provide(
      ObservedRunGate.layer.pipe(Layer.provideMerge(Store.layerDefaultMemory)),
    ),
    Effect.scoped,
  );

  yield* Effect.log("");
  yield* Effect.log("=== make: run-only handle (no observation) ===");

  const unobserved = yield* RunResource.make({
    name: "examples/UnobservedRunGate",
    effect: (n: number) => Effect.succeed(n * 2),
  });
  const value = yield* unobserved.run(21);
  yield* Effect.log(`unobserved result: ${String(value)}`);
}).pipe(Effect.provide(Store.layerDefaultMemory), Effect.scoped);

void Effect.runPromise(program);

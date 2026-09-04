/**
 * @module examples/gate/runtime-observer
 *
 * Live observation on {@link Gate.define} handles via {@link Subscribable}
 * views (`status`, `waiting`, `completed`, …). `Service.layer` already merges the
 * default store bridge — no extra `Store.layerDefaultMemory` is required here.
 *
 * Run: `pnpm run example:gate-runtime-observer`
 *
 * Docs: `docs/examples/gate/runtime-observer.md` includes this file;
 * cut markers hide the module header and runner epilogue.
 */

// ---cut---
import { Effect, Ref, Schema, Stream } from "effect";
import { Gate, Store } from "../../src";

const ObservedGate = Gate.define<{ readonly _tag: "ObservedGate" }>()(
  "examples/ObservedGate",
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
    const gate = yield* ObservedGate;
    const completedSamples = yield* Ref.make<ReadonlyArray<number>>([]);

    yield* Stream.runForEach(gate.completed.changes, (n) =>
      Ref.update(completedSamples, (items) => [...items, n]),
    ).pipe(
      Effect.forkScoped,
      Effect.flatMap(() =>
        Effect.gen(function* () {
          yield* gate.run(1);
          yield* gate.run(-1).pipe(Effect.flip);
          yield* ObservedGate.run(2);

          const samples = yield* Ref.get(completedSamples);
          const status = yield* gate.status.get;

          yield* Effect.log(`completed.changes samples: ${samples.join(", ")}`);
          yield* Effect.log(
            `status: completed=${String(status.completed)}, failed=${String(status.failed)}, waiting=${String(status.waiting)}, inFlight=${String(status.inFlight)}`,
          );
        }),
      ),
    );
  }).pipe(Effect.provide(ObservedGate.layer), Effect.scoped);

  yield* Effect.log("");
  yield* Effect.log("=== make: run-only handle (no observation) ===");
  yield* Effect.log("(Gate.make still needs Store.layerDefaultMemory on the effect — see below)");

  const unobserved = yield* Gate.make({
    name: "examples/UnobservedGate",
    effect: (n: number) => Effect.succeed(n * 2),
  });
  const value = yield* unobserved.run(21);
  yield* Effect.log(`unobserved result: ${String(value)}`);
}).pipe(Effect.provide(Store.layerDefaultMemory), Effect.scoped);

// ---cut-after---
void Effect.runPromise(program);

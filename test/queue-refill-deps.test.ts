import { Context, Effect, Fiber, Layer, Schema, Stream } from "effect";
import { expect, it } from "vitest";
import { WorkPool } from "../src";
import * as Hyperlink from "../src/Hyperlink";

// A refill loader that needs its OWN service dependency (like wow's Prisma repo) — distinct from
// the worker, which needs nothing. Probes whether the refill's R is surfaced + provided.
class Source extends Context.Service<Source, { readonly load: () => Effect.Effect<ReadonlyArray<number>> }>()(
  "hyperlink-ts/test/queue-refill-deps.test/Source",
) {}
const SourceLive = Layer.succeed(Source, Source.of({ load: () => Effect.succeed([1, 2, 3]) }));

const Item = Schema.Struct({ n: Schema.Number });
class Q extends WorkPool.Service<Q>()("queue-refill-deps/Q", { payload: Item }) {}

const queueLayer = WorkPool.layerMemory(Q, {
  effect: (_item: { n: number }) => Effect.void, // worker needs nothing
  // deferStart so the test can subscribe to the live status before the refill runs (the
  // refill fires when the worker pool starts, which we trigger explicitly via `start`).
  refill: {
    onStart: true,
    load: (q) =>
      Source.pipe(
        Effect.flatMap((s) => s.load()),
        Effect.flatMap((ns) => q.add(ns.map((n) => ({ n })))),
        Effect.orDie,
      ),
  },
}).pipe(Hyperlink.deferStart);

it("refill loader gets its own service dependency", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const q = yield* Q;
      // subscribe to the live status delta stream BEFORE starting (so we observe the refill's
      // enqueue + processing rather than missing an already-past update).
      const completed = yield* Effect.forkChild(
        Stream.runHead(
          Stream.filter(
            q.status.changes,
            (s) => s.completed >= 3,
          ),
        ),
      );
      yield* q.start; // fires the onStart refill, which pulls from Source and enqueues 1,2,3
      const done = yield* Fiber.join(completed);
      expect(done._tag === "Some" && done.value.completed >= 3).toBe(true);
    }).pipe(
      Effect.provide(queueLayer.pipe(Layer.provide(SourceLive))),
      Effect.scoped,
    ),
  ));

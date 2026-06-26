import { Context, Duration, Effect, Layer, Schema } from "effect";
import { expect, it } from "vitest";
import { QueueResource } from "../src";

// A refill loader that needs its OWN service dependency (like wow's Prisma repo) — distinct from
// the worker, which needs nothing. Probes whether the refill's R is surfaced + provided.
class Source extends Context.Service<Source, { readonly load: () => Effect.Effect<ReadonlyArray<number>> }>()(
  "@nikscripts/effect-pm/test/queue-refill-deps.test/Source",
) {}
const SourceLive = Layer.succeed(Source, Source.of({ load: () => Effect.succeed([1, 2, 3]) }));

const Item = Schema.Struct({ n: Schema.Number });
class Q extends QueueResource.Tag<Q>()("queue-refill-deps/Q", Item) {}

const queueLayer = QueueResource.layer(Q, {
  effect: (_item: { n: number }) => Effect.void, // worker needs nothing
  refill: {
    onStart: true,
    load: (q) =>
      Source.pipe(
        Effect.flatMap((s) => s.load()),
        Effect.flatMap((ns) => q.add(ns.map((n) => ({ n })))),
        Effect.orDie,
      ),
  },
});

it("refill loader gets its own service dependency", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const q = yield* Q;
      while ((yield* q.completed) < 3) yield* Effect.sleep(Duration.millis(10));
      expect(yield* q.completed).toBe(3);
    }).pipe(
      Effect.provide(queueLayer.pipe(Layer.provide(SourceLive))),
      Effect.scoped,
    ),
  ));

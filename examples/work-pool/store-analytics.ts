/**
 * @module examples/work-pool/store-analytics
 *
 * WorkPool.store(tag) soft analytics: lifecycle facts are auto-recorded in a
 * Store.Service registration and queried through failureRate / slowest / stats / latency.
 *
 * Tip surface: `WorkPool.store(tag)` + `Store.Service`. Run: `pnpm run example:work-pool-store-analytics`
 *
 * Docs: `docs/examples/work-pool/store-analytics.md` includes this file via Twoslash;
 * `// ---cut---` hides this module header from the page (Twoslash still type-checks it).
 */

// ---cut---
import { Duration, Effect, Layer, Option, Schema } from "effect";
import { Store, WorkPool } from "../../src";

const AnalyticsJob = Schema.Struct({
  id: Schema.String,
  fail: Schema.Boolean,
});

class AnalyticsQueue extends WorkPool.Service<AnalyticsQueue>()(
  "examples/AnalyticsQueue",
  {
    payload: AnalyticsJob,
    error: Schema.String,
  },
) {}

class AnalyticsStore extends Store.Service<AnalyticsStore>(
  "examples/AnalyticsStore",
)(WorkPool.store(AnalyticsQueue)) {}

const waitUntilCompleted = (expected: number) =>
  Effect.gen(function* () {
    const queue = yield* AnalyticsQueue;
    while ((yield* queue.status.get).completed < expected) {
      yield* Effect.sleep(Duration.millis(10));
    }
  }).pipe(Effect.timeout(Duration.seconds(3)));

const AnalyticsLive = WorkPool.layer(AnalyticsQueue, {
  concurrency: 1,
  attempts: 1,
  effect: (job) =>
    Effect.gen(function* () {
      yield* Effect.sleep(Duration.millis(job.id === "slow" ? 40 : 5));
      if (job.fail) return yield* Effect.fail(`failed:${job.id}`);
      yield* Effect.logInfo(`processed ${job.id}`);
    }),
}).pipe(Layer.provideMerge(AnalyticsStore.layerMemory));

const program = Effect.gen(function* () {
  const queue = yield* AnalyticsQueue;

  yield* queue.add([
    { id: "fast", fail: false },
    { id: "bad", fail: true },
    { id: "slow", fail: false },
  ]);

  yield* waitUntilCompleted(3);

  const store = yield* AnalyticsStore;
  const stats = yield* store.stats();
  const failureRate = yield* store.failureRate();
  const slowest = yield* store.slowest(2);
  const latency = yield* store.latency();
  const lastFailure = yield* store.lastFailure();

  yield* Effect.logInfo(
    `stats: enqueued=${String(stats.enqueued)}, completed=${String(stats.completed)}, failed=${String(stats.failed)}`,
  );
  yield* Effect.logInfo(`failure rate: ${failureRate.toFixed(2)}`);
  yield* Effect.logInfo(
    `slowest: ${slowest.map((event) => event.entry.item.id).join(", ")}`,
  );
  yield* Effect.logInfo(
    `latency mean=${String(Duration.toMillis(latency.mean))}ms max=${String(Duration.toMillis(latency.max))}ms`,
  );
  yield* Effect.logInfo(
    `last failure: ${Option.match(lastFailure, {
      onNone: () => "none",
      onSome: (event) => event.entry.item.id,
    })}`,
  );
});

void Effect.runPromise(
  program.pipe(
    Effect.provide(AnalyticsLive),
    Effect.scoped,
    Effect.tap(() => Effect.logInfo("example:work-pool-store-analytics finished OK")),
  ),
);

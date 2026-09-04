/**
 * @module examples/work-pool/history-metrics
 *
 * HistoryStore captures WorkPool metrics windows so `metrics.query` can read back the
 * same aggregate shape that `metrics.stream` emits live.
 *
 * Tip surface: `HistoryStore.layerMemory` + `metrics.query`. Run: `pnpm run example:work-pool-history-metrics`
 *
 * Docs: `docs/examples/work-pool/history-metrics.md` includes this file via Twoslash;
 * `// ---cut---` hides this module header from the page (Twoslash still type-checks it).
 */

// ---cut---
import { Duration, Effect, Layer, Schema } from "effect";
import { HistoryStore, WorkPool } from "../../src";

const MetricsJob = Schema.Struct({
  id: Schema.String,
});

class MetricsQueue extends WorkPool.Service<MetricsQueue>()(
  "examples/MetricsQueue",
  { payload: MetricsJob },
) {}

const waitUntilCompleted = (expected: number) =>
  Effect.gen(function* () {
    const queue = yield* MetricsQueue;
    while ((yield* queue.status.get).completed < expected) {
      yield* Effect.sleep(Duration.millis(10));
    }
  }).pipe(Effect.timeout(Duration.seconds(3)));

const waitForHistory = () =>
  Effect.gen(function* () {
    const queue = yield* MetricsQueue;
    while (true) {
      const windows = yield* queue.metrics.query({ limit: 5 });
      const completed = windows.reduce((sum, window) => sum + window.completed, 0);
      if (completed > 0) return windows;
      yield* Effect.sleep(Duration.millis(10));
    }
  }).pipe(Effect.timeout(Duration.seconds(3)));

const MetricsLive = WorkPool.layer(MetricsQueue, {
  concurrency: 1,
  effect: (job) => Effect.logInfo(`metric job ${job.id}`),
}).pipe(Layer.provideMerge(HistoryStore.layerMemory()));

const program = Effect.gen(function* () {
  const queue = yield* MetricsQueue;

  yield* queue.add([{ id: "m1" }, { id: "m2" }, { id: "m3" }]);
  yield* waitUntilCompleted(3);

  const windows = yield* waitForHistory();
  const totals = windows.reduce(
    (acc, window) => ({
      enqueued: acc.enqueued + window.enqueued,
      completed: acc.completed + window.completed,
    }),
    { enqueued: 0, completed: 0 },
  );

  yield* Effect.logInfo(`history windows: ${String(windows.length)}`);
  yield* Effect.logInfo(
    `history totals: enqueued=${String(totals.enqueued)}, completed=${String(totals.completed)}`,
  );
});

void Effect.runPromise(
  program.pipe(
    Effect.provide(MetricsLive),
    Effect.scoped,
    Effect.tap(() => Effect.logInfo("example:work-pool-history-metrics finished OK")),
  ),
);

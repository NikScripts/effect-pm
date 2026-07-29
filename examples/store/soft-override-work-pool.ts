/**
 * @module examples/store/soft-override-work-pool
 *
 * Toolkit layers soft-default to in-memory `Storage`. Provide your `AppStore` into
 * `WorkPool.layer` so Soft unwrap captures that store and the queue writes its journal there.
 * Run: `pnpm run example:store-soft-override-work-pool`
 *
 * Docs: `docs/examples/store/soft-override-work-pool.md` includes this file;
 * cut markers hide the module header and runner epilogue.
 */

import { runNodeProgramOrExit } from "../shared/demo-harness";

// ---cut---
import { Duration, Effect, Layer, Schema } from "effect";
import * as Store from "../../src/Store";
import * as WorkPool from "../../src/WorkPool";

const Job = Schema.Struct({ id: Schema.String });

class ImportQueue extends WorkPool.Tag<ImportQueue>()("examples/store/ImportQueue", {
  payload: Job,
}) {}

class AppStore extends Store.Service<AppStore>("@examples/store/SoftOverrideStore")(
  WorkPool.store(ImportQueue),
) {}

const waitUntilCompleted = (expected: number) =>
  Effect.gen(function* () {
    const queue = yield* ImportQueue;
    for (let i = 0; i < 100; i++) {
      const { completed } = yield* queue.status.get;
      if (completed >= expected) return;
      yield* Effect.sleep(Duration.millis(20));
    }
    return yield* Effect.die("timed out waiting for ImportQueue");
  });

const ImportQueueLive = WorkPool.layer(ImportQueue, {
  concurrency: 1,
  effect: (job) => Effect.logInfo(`imported ${job.id}`),
}).pipe(
  // This is the Soft override: AppStore is provided into the WorkPool layer.
  Layer.provideMerge(AppStore.layerMemory),
);

const program = Effect.gen(function* () {
  const queue = yield* ImportQueue;
  yield* queue.add({ id: "customers.csv" });
  yield* waitUntilCompleted(1);

  const store = yield* AppStore;
  const events = yield* store.events();
  const completed = events.filter((event) => event._tag === "Completed");

  yield* Effect.logInfo(`AppStore queue events: ${String(events.length)}`);
  yield* Effect.logInfo(`completed rows in AppStore: ${String(completed.length)}`);
}).pipe(
  // @effect-diagnostics-next-line strictEffectProvide:off
  Effect.provide(ImportQueueLive),
  Effect.scoped,
  Effect.orDie,
);
// ---cut-after---

runNodeProgramOrExit(program, "store soft-override-work-pool example finished");

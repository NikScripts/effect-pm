/**
 * @module examples/store/durable-and-soft
 *
 * `DurableWorkPoolStore` is the WorkPool backlog source of truth. `WorkPool.store(tag)` on an
 * `AppStore` is the Soft observability journal. They are separate planes and can be provided together.
 * Run: `pnpm run example:store-durable-and-soft`
 *
 * Docs: `docs/examples/store/durable-and-soft.md` includes this file;
 * cut markers hide the module header and runner epilogue.
 */

import { runNodeProgramOrExit } from "../shared/demo-harness";

// ---cut---
import { Duration, Effect, Layer, Schema } from "effect";
import { DurableWorkPoolStore } from "../../src/DurableWorkPoolStore";
import * as Store from "../../src/Store";
import * as Hyperlink from "../../src/Hyperlink";
import * as WorkPool from "../../src/WorkPool";
import { SQLiteDurableWorkPoolStore } from "../../src/storage/sqlite";

const Job = Schema.Struct({ id: Schema.String });

class DurableQueue extends WorkPool.Tag<DurableQueue>()("examples/store/DurableQueue", {
  payload: Job,
}) {}

const durableQueueStore = WorkPool.store(DurableQueue);

class AppStore extends Store.Service<AppStore>("@examples/store/DurableAndSoftStore")(
  durableQueueStore,
) {}

const waitUntilCompleted = (expected: number) =>
  Effect.gen(function* () {
    const queue = yield* DurableQueue;
    for (let i = 0; i < 150; i++) {
      const { completed } = yield* queue.status.get;
      if (completed >= expected) return completed;
      yield* Effect.sleep(Duration.millis(20));
    }
    return yield* Effect.die("timed out waiting for durable queue recovery");
  });

const firstRuntime = Effect.gen(function* () {
  const queue = yield* DurableQueue;
  yield* queue.add([{ id: "a" }, { id: "b" }]);

  const store = yield* AppStore;
  const events = yield* store.events();
  yield* Effect.logInfo(`first runtime pending backlog: ${String(yield* queue.size.get)}`);
  yield* Effect.logInfo(`first runtime Soft events: ${String(events.length)}`);
  return events.length;
}).pipe(
  // @effect-diagnostics-next-line strictEffectProvide:off
  Effect.provide(
    WorkPool.layer(DurableQueue, {
      effect: (job) => Effect.logInfo(`should run after restart: ${job.id}`),
    }).pipe(Hyperlink.deferStart, Layer.provideMerge(AppStore.layerMemory)),
  ),
  Effect.scoped,
);

const secondRuntime = Effect.gen(function* () {
  const completed = yield* waitUntilCompleted(2);

  const store = yield* AppStore;
  const events = yield* store.events();
  yield* Effect.logInfo(`second runtime recovered completions: ${String(completed)}`);
  yield* Effect.logInfo(`second runtime Soft events: ${String(events.length)}`);
  return events.length;
}).pipe(
  // @effect-diagnostics-next-line strictEffectProvide:off
  Effect.provide(
    WorkPool.layer(DurableQueue, {
      concurrency: 1,
      effect: (job) => Effect.logInfo(`recovered durable job ${job.id}`),
    }).pipe(Layer.provideMerge(AppStore.layerMemory)),
  ),
  Effect.scoped,
);

const program = Effect.gen(function* () {
  const durable = yield* DurableWorkPoolStore;
  yield* durable.clear(DurableQueue.key).pipe(Effect.orDie);

  const firstSoftRows = yield* firstRuntime;
  const secondSoftRows = yield* secondRuntime;

  yield* Effect.logInfo(
    `durable backlog survived a queue rematerialization; Soft journals were per-runtime: ${String(
      firstSoftRows,
    )} then ${String(secondSoftRows)}`,
  );
}).pipe(
  // @effect-diagnostics-next-line strictEffectProvide:off
  Effect.provide(SQLiteDurableWorkPoolStore.layer({ filename: ":memory:" })),
  Effect.scoped,
  Effect.orDie,
);
// ---cut-after---

runNodeProgramOrExit(program, "store durable-and-soft example finished");

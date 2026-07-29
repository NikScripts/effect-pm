/**
 * @module examples/store/one-store-many-regs
 *
 * One `Store.Service` per Node can carry many registrations: `Node.logs`,
 * `WorkPool.store(tag)`, and `Daemon.store(tag)` share one journal and one `Logs.layer`.
 * Run: `pnpm run example:store-one-store-many-regs`
 *
 * Docs: `docs/examples/store/one-store-many-regs.md` includes this file;
 * cut markers hide the module header and runner epilogue.
 */

import { runNodeProgramOrExit } from "../shared/demo-harness";

// ---cut---
import { Duration, Effect, Layer, Schema } from "effect";
import * as Daemon from "../../src/Daemon";
import * as Logs from "../../src/Logs";
import * as Node from "../../src/Node";
import * as Store from "../../src/Store";
import * as WorkPool from "../../src/WorkPool";

class DemoNode extends Node.Tag<DemoNode>()("examples/store/one-store") {}

const Job = Schema.Struct({ id: Schema.String });

class ImportQueue extends WorkPool.Tag<ImportQueue>()("examples/store/OneStoreQueue", {
  payload: Job,
}) {}

class Heartbeat extends Daemon.Tag<Heartbeat>()("examples/store/Heartbeat") {}

/** Custom keys → `yield* AppStore.at("queue")` (tag-keyed `.at(Tag)` is equivalent at runtime). */
class AppStore extends Store.Service<AppStore>("@examples/store/OneStore")({
  node: DemoNode.logs,
  queue: WorkPool.store(ImportQueue),
  daemon: Daemon.store(Heartbeat),
}) {}

const waitUntil = (predicate: Effect.Effect<boolean>) =>
  Effect.gen(function* () {
    for (let i = 0; i < 100; i++) {
      if (yield* predicate) return;
      yield* Effect.sleep(Duration.millis(20));
    }
    return yield* Effect.die("timed out waiting for one-store demo");
  });

const Live = Layer.mergeAll(
  WorkPool.layer(ImportQueue, {
    concurrency: 1,
    effect: (job) => Effect.logInfo(`one-store queue processed ${job.id}`),
  }),
  Daemon.layer(Heartbeat, {
    effect: Effect.logInfo("one-store daemon tick"),
  }),
).pipe(Layer.provideMerge(AppStore.layerMemory));

const program = Effect.gen(function* () {
  const queue = yield* ImportQueue;
  const heartbeat = yield* Heartbeat;

  yield* Effect.logInfo("one-store node line");
  yield* queue.add({ id: "customers.csv" });
  yield* heartbeat.run;

  yield* waitUntil(
    Effect.map(queue.status.get, (status) => status.completed >= 1),
  );
  yield* waitUntil(
    Effect.map(Logs.byNode(DemoNode, { limit: 100 }), (rows) =>
      rows.some((row) => row.message === "one-store node line"),
    ),
  );

  const queueStore = yield* AppStore.at("queue");
  const daemonStore = yield* AppStore.at("daemon");
  const queueEvents = yield* queueStore.events();
  const daemonEvents = yield* daemonStore.events();
  const nodeRows = yield* Logs.byNode(DemoNode, { limit: 100 });

  yield* Effect.logInfo(`node log rows: ${String(nodeRows.length)}`);
  yield* Effect.logInfo(`queue event rows: ${String(queueEvents.length)}`);
  yield* Effect.logInfo(`daemon event rows: ${String(daemonEvents.length)}`);
}).pipe(
  // @effect-diagnostics-next-line strictEffectProvide:off
  Effect.provide(Live),
  Effect.scoped,
  Effect.orDie,
);
// ---cut-after---

runNodeProgramOrExit(program, "store one-store-many-regs example finished");

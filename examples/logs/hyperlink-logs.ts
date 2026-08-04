/**
 * @module examples/logs/hyperlink-logs
 *
 * `Hyperlink.logs(tag)` exports a Handle-shaped `{ stream, query }` for one HyperService. This
 * example uses a tiny WorkPool as the producer: worker `Effect.logInfo` lines inherit queue lineage,
 * so the live stream and durable query both filter to the queue's key.
 * Run: `pnpm run example:logs-hyperlink-logs`
 *
 * Docs: `docs/examples/logs/hyperlink-logs.md` includes this file;
 * cut markers hide the module header and runner epilogue.
 */

import { runNodeProgramOrExit } from "../shared/demo-harness";

// ---cut---
import { Duration, Effect, Fiber, Layer, Schema, Stream } from "effect";
import * as Hyperlink from "../../src/Hyperlink";
import * as Store from "../../src/Store";
import * as WorkPool from "../../src/WorkPool";

const Job = Schema.Struct({ id: Schema.String });

class MailQueue extends WorkPool.Service<MailQueue>()("examples/logs/MailQueue", {
  payload: Job,
}) {}

const mailQueueRegistration = WorkPool.store(MailQueue);
class AppStore extends Store.Service<AppStore>("@examples/logs/HyperlinkLogsStore")(
  mailQueueRegistration,
) {}

const waitUntilCompleted = (expected: number) =>
  Effect.gen(function* () {
    const queue = yield* MailQueue;
    for (let i = 0; i < 100; i++) {
      const { completed } = yield* queue.status.get;
      if (completed >= expected) return;
      yield* Effect.sleep(Duration.millis(20));
    }
    return yield* Effect.die("timed out waiting for MailQueue to complete");
  });

const waitForDurableLine = (query: () => Effect.Effect<ReadonlyArray<unknown>>) =>
  Effect.gen(function* () {
    for (let i = 0; i < 50; i++) {
      const rows = yield* query();
      if (rows.length > 0) return rows;
      yield* Effect.sleep(Duration.millis(20));
    }
    return yield* Effect.die("timed out waiting for Hyperlink.logs query rows");
  });

const MailQueueLive = WorkPool.layer(MailQueue, {
  concurrency: 1,
  effect: (job) => Effect.logInfo(`worker processed ${job.id}`),
}).pipe(Layer.provideMerge(AppStore.layerMemory));

const program = Effect.gen(function* () {
  const queue = yield* MailQueue;
  const logs = yield* Hyperlink.logs(MailQueue);

  const live = yield* Effect.forkChild(
    logs.stream.pipe(
      Stream.filter((entry) => entry.message === "worker processed welcome"),
      Stream.take(1),
      Stream.runCollect,
    ),
  );

  yield* queue.add({ id: "welcome" });
  yield* waitUntilCompleted(1);

  const [entry] = Array.from(yield* Fiber.join(live));
  const history = yield* waitForDurableLine(() => logs.query({ limit: 20 }));

  yield* Effect.logInfo(`Hyperlink.logs stream saw: ${entry?.message ?? "<missing>"}`);
  yield* Effect.logInfo(`Hyperlink.logs query rows: ${String(history.length)}`);
}).pipe(
  // @effect-diagnostics-next-line strictEffectProvide:off
  Effect.provide(MailQueueLive),
  Effect.scoped,
  Effect.orDie,
);
// ---cut-after---

runNodeProgramOrExit(program, "logs hyperlink-logs example finished");

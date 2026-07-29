/**
 * @module examples/work-pool/durable-sqlite
 *
 * Durable backlog with SQLiteDurableWorkPoolStore: enqueue while the first queue runtime is
 * not started, rebuild the layer over the same SQLite file, then drain the recovered work.
 *
 * Tip surface: `SQLiteDurableWorkPoolStore.layer`. Run: `pnpm run example:work-pool-durable-sqlite`
 *
 * Docs: `docs/examples/work-pool/durable-sqlite.md` includes this file via Twoslash;
 * `// ---cut---` hides this module header from the page (Twoslash still type-checks it).
 */

// ---cut---
import { Duration, Effect, Layer, Ref, Schema } from "effect";
import { WorkPool } from "../../src";
import { SQLiteDurableWorkPoolStore } from "../../src/storage/sqlite";

const DurableJob = Schema.Struct({
  id: Schema.String,
  n: Schema.Number,
});

class DurableQueue extends WorkPool.Tag<DurableQueue>()(
  "examples/DurableQueue",
  { payload: DurableJob },
) {}

const waitUntilCompleted = (expected: number) =>
  Effect.gen(function* () {
    const queue = yield* DurableQueue;
    while ((yield* queue.status.get).completed < expected) {
      yield* Effect.sleep(Duration.millis(10));
    }
  }).pipe(Effect.timeout(Duration.seconds(3)));

const sqliteLayer = (filename: string) =>
  SQLiteDurableWorkPoolStore.layer({ filename });

const queueLayer = (
  filename: string,
  processed: Ref.Ref<ReadonlyArray<string>>,
  autoStart: boolean,
) =>
  WorkPool.layer(DurableQueue, {
    autoStart,
    concurrency: 1,
    key: (job) => job.id,
    effect: (job) =>
      Ref.update(processed, (items) => [...items, job.id]).pipe(
        Effect.tap(() => Effect.logInfo(`drained durable job ${job.id}`)),
      ),
  }).pipe(Layer.provideMerge(sqliteLayer(filename)));

const program = Effect.gen(function* () {
  const filename = `/tmp/hyperlink-work-pool-durable-${String(Date.now())}.sqlite`;
  const processed = yield* Ref.make<ReadonlyArray<string>>([]);

  yield* Effect.gen(function* () {
    const queue = yield* DurableQueue;
    yield* queue.add([
      { id: "a", n: 1 },
      { id: "b", n: 2 },
      { id: "c", n: 3 },
    ]);
    const pending = yield* queue.size.get;
    yield* Effect.logInfo(`first runtime persisted pending=${String(pending)}`);
  }).pipe(
    Effect.provide(queueLayer(filename, processed, false)),
    Effect.scoped,
  );

  yield* Effect.gen(function* () {
    yield* waitUntilCompleted(3);
    const ids = [...(yield* Ref.get(processed))].sort();
    yield* Effect.logInfo(`second runtime recovered: ${ids.join(", ")}`);
    const queue = yield* DurableQueue;
    const pending = yield* queue.size.get;
    yield* Effect.logInfo(`pending after recovery: ${String(pending)}`);
  }).pipe(
    Effect.provide(queueLayer(filename, processed, true)),
    Effect.scoped,
  );
});

void Effect.runPromise(
  program.pipe(
    Effect.scoped,
    Effect.tap(() => Effect.logInfo("example:work-pool-durable-sqlite finished OK")),
  ),
);

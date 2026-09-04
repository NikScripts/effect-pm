/**
 * @module examples/work-pool/refill
 *
 * WorkPool refill loaders: `onStart` seeds the queue when workers start, and `onDrained`
 * re-polls the source each time the queue empties.
 *
 * Tip surface: `refill.onStart` / `refill.onDrained`. Run: `pnpm run example:work-pool-refill`
 *
 * Docs: `docs/examples/work-pool/refill.md` includes this file via Twoslash;
 * `// ---cut---` hides this module header from the page (Twoslash still type-checks it).
 */

// ---cut---
import { Duration, Effect, Ref, Schema } from "effect";
import * as Hyperlink from "../../src/Hyperlink";
import { WorkPool } from "../../src";

const PullJob = Schema.Struct({
  id: Schema.String,
});

type PullJob = typeof PullJob.Type;

class PullQueue extends WorkPool.Service<PullQueue>()("examples/PullQueue", {
  payload: PullJob,
}) {}

const waitUntilCompleted = (expected: number) =>
  Effect.gen(function* () {
    const queue = yield* PullQueue;
    while ((yield* queue.status.get).completed < expected) {
      yield* Effect.sleep(Duration.millis(10));
    }
  }).pipe(Effect.timeout(Duration.seconds(3)));

const makeLive = (
  batches: Ref.Ref<ReadonlyArray<ReadonlyArray<PullJob>>>,
  processed: Ref.Ref<ReadonlyArray<string>>,
) =>
  WorkPool.layer(PullQueue, {
    concurrency: 1,
    effect: (job) =>
      Ref.update(processed, (ids) => [...ids, job.id]).pipe(
        Effect.tap(() => Effect.logInfo(`handled ${job.id}`)),
      ),
    refill: {
      onStart: true,
      onDrained: true,
      load: (queue) =>
        Effect.gen(function* () {
          const batch = yield* Ref.modify(batches, (remaining) => {
            const [head, ...tail] = remaining;
            return [head ?? [], tail] as const;
          });
          if (batch.length === 0) {
            yield* Effect.logInfo("refill source empty");
            return;
          }
          yield* Effect.logInfo(`refill loaded ${String(batch.length)} job(s)`);
          yield* queue.add(batch).pipe(Effect.orDie);
        }),
    },
  }).pipe(Hyperlink.deferStart);

const program = Effect.gen(function* () {
  const batches = yield* Ref.make<ReadonlyArray<ReadonlyArray<PullJob>>>([
    [{ id: "boot-a" }, { id: "boot-b" }],
    [{ id: "after-drain" }],
  ]);
  const processed = yield* Ref.make<ReadonlyArray<string>>([]);

  yield* Effect.gen(function* () {
    const queue = yield* PullQueue;
    yield* Effect.logInfo("starting queue; onStart will load the first batch");
    yield* queue.start;
    yield* waitUntilCompleted(3);
    const order = yield* Ref.get(processed);
    yield* Effect.logInfo(`processed order: ${order.join(" -> ")}`);
  }).pipe(
    Effect.provide(makeLive(batches, processed)),
    Effect.scoped,
  );
});

void Effect.runPromise(
  program.pipe(
    Effect.tap(() => Effect.logInfo("example:work-pool-refill finished OK")),
  ),
);

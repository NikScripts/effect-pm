/**
 * @module examples/work-pool/typed-success
 *
 * WorkPool success values: declare `success` on the Tag, return that shape from the
 * worker, and read it back from the typed `Completed.success` field.
 *
 * Tip surface: tag `success` + `Completed.success`. Run: `pnpm run example:work-pool-typed-success`
 *
 * Docs: `docs/examples/work-pool/typed-success.md` includes this file via Twoslash;
 * `// ---cut---` hides this module header from the page (Twoslash still type-checks it).
 */

// ---cut---
import { Duration, Effect, Ref, Schema } from "effect";
import { Hyperlink, WorkPool } from "../../src";

const RenderJob = Schema.Struct({
  id: Schema.String,
});

class RenderQueue extends WorkPool.Tag<RenderQueue>()("examples/RenderQueue", {
  payload: RenderJob,
  success: Schema.Number,
}) {}

const waitUntilCompleted = (expected: number) =>
  Effect.gen(function* () {
    const queue = yield* RenderQueue;
    while ((yield* queue.status.get).completed < expected) {
      yield* Effect.sleep(Duration.millis(10));
    }
  }).pipe(Effect.timeout(Duration.seconds(3)));

const RenderLive = WorkPool.layer(RenderQueue, {
  concurrency: 1,
  effect: (job) => Effect.succeed(job.id.length * 10),
});

const program = Effect.gen(function* () {
  const queue = yield* RenderQueue;
  const successes = yield* Ref.make<ReadonlyArray<string>>([]);

  yield* Effect.forkScoped(
    queue.events.pipe(
      Hyperlink.runForEachTag({
        Completed: (event) =>
          Ref.update(successes, (rows) => [
            ...rows,
            `${event.entry.item.id}:${String(event.success)}b`,
          ]).pipe(
            Effect.tap(() =>
              Effect.logInfo(
                `completed ${event.entry.item.id} with ${String(event.success)} bytes`,
              ),
            ),
          ),
      }),
    ),
  );
  yield* Effect.sleep(Duration.millis(10));

  yield* queue.add([
    { id: "welcome" },
    { id: "reset" },
  ]);
  yield* waitUntilCompleted(2);

  const rows = yield* Ref.get(successes);
  yield* Effect.logInfo(`typed successes: ${rows.join(", ")}`);
});

void Effect.runPromise(
  program.pipe(
    Effect.provide(RenderLive),
    Effect.scoped,
    Effect.tap(() => Effect.logInfo("example:work-pool-typed-success finished OK")),
  ),
);

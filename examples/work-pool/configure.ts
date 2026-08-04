/**
 * @module examples/work-pool/configure
 *
 * WorkPool.configure applies config patches when the layer is built. This example patches
 * a base queue to start paused, enqueues work, then resumes the patched runtime.
 *
 * Tip surface: `WorkPool.configure(Tag, patch)`. Run: `pnpm run example:work-pool-configure`
 *
 * Docs: `docs/examples/work-pool/configure.md` includes this file via Twoslash;
 * `// ---cut---` hides this module header from the page (Twoslash still type-checks it).
 */

// ---cut---
import { Duration, Effect, Layer, Schema } from "effect";
import { WorkPool } from "../../src";

const ConfigJob = Schema.Struct({
  id: Schema.String,
});

class ConfigQueue extends WorkPool.Service<ConfigQueue>()(
  "examples/ConfigQueue",
  { payload: ConfigJob },
) {}

const waitUntilCompleted = (expected: number) =>
  Effect.gen(function* () {
    const queue = yield* ConfigQueue;
    while ((yield* queue.status.get).completed < expected) {
      yield* Effect.sleep(Duration.millis(10));
    }
  }).pipe(Effect.timeout(Duration.seconds(3)));

const BaseQueueLive = WorkPool.layer(ConfigQueue, {
  paused: false,
  concurrency: 1,
  effect: (job) => Effect.logInfo(`configured worker handled ${job.id}`),
});

const TunedQueueLive = BaseQueueLive.pipe(
  Layer.provideMerge(
    WorkPool.configure(ConfigQueue, {
      paused: true,
      concurrency: 2,
    }),
  ),
);

const program = Effect.gen(function* () {
  const queue = yield* ConfigQueue;
  const initial = yield* queue.status.get;

  yield* Effect.logInfo(`patched paused=${String(initial.paused)}`);
  yield* queue.add([{ id: "cfg-a" }, { id: "cfg-b" }]);
  const pending = yield* queue.size.get;
  yield* Effect.logInfo(`pending while paused: ${String(pending)}`);

  yield* queue.resume;
  yield* waitUntilCompleted(2);
  yield* Effect.logInfo("configured queue drained after resume");
});

void Effect.runPromise(
  program.pipe(
    Effect.provide(TunedQueueLive),
    Effect.scoped,
    Effect.tap(() => Effect.logInfo("example:work-pool-configure finished OK")),
  ),
);

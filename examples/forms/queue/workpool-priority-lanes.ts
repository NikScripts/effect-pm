/**
 * @module examples/forms/queue/custom-queue-hyperlink-n-level
 *
 * WorkPool.priority — N named priority lanes, `add(item, lane?)`, and `sizes: Record<string, number>`.
 * `layerMemory` soft-defaults in-memory Storage (R fulfilled). For durable journals + Logs,
 * Soft-override: `WorkPool.layer(…).pipe(Layer.provideMerge(AppStore.layer…))`
 * — see `docs/guides/stores.md`.
 * Run: `pnpm run example:custom-queue-hyperlink`
 */

import { Effect, Schema } from "effect";
import { WorkPool } from "../../../src";

const JobSchema = Schema.Struct({ id: Schema.String, kind: Schema.String });

/** Tag factory: config object — `{ payload, laneCount, namedLanes? }`. */
class Jobs extends WorkPool.priority<Jobs>()("examples/CustomJobs", {
  payload: JobSchema,
  laneCount: 4,
  namedLanes: { interactive: 0, standard: 2, batch: 3 },
}) {}

const program = Effect.gen(function* () {
  const queue = yield* Jobs;

  // Pair-style add — level is a configured name or numeric index.
  yield* queue.add({ id: "a", kind: "email" }, "interactive");
  yield* queue.add({ id: "b", kind: "report" }, "batch");
  yield* queue.add([{ id: "c", kind: "email" }, { id: "d", kind: "email" }], 2);

  const sizes = (yield* queue.status.get).sizes;
  yield* Effect.log(`sizes: ${Object.entries(sizes).map(([k, n]) => `${k}=${String(n)}`).join(", ")}`);

  const levelSizes = yield* queue.levelSizes;
  yield* Effect.log(`levelSizes: ${levelSizes.join(", ")}`);
});

Effect.runPromise(
  program.pipe(
    Effect.provide(
      WorkPool.layerMemory(Jobs, {
        laneCount: 4,
        namedLanes: { interactive: 0, standard: 2, batch: 3 },
        takeAlgorithm: "weighted",
        concurrency: 2,
        effect: (job) => Effect.logInfo(`processed ${job.id} (${job.kind})`),
        autoStart: true,
      }),
    ),
    Effect.scoped,
  ),
).catch(console.error);

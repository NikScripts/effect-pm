/**
 * @module examples/forms/queue/custom-queue-resource-n-level
 *
 * CustomQueueResource — N named lanes, `add(item, level?)`, and `sizes: Record<string, number>`.
 * Run: `pnpm run example:custom-queue-resource`
 */

import { Effect, Schema } from "effect";
import { CustomQueueResource } from "../../../src";

const JobSchema = Schema.Struct({ id: Schema.String, kind: Schema.String });

/** Tag factory: config object — `{ payload, levelCount, namedLevels? }`. */
class Jobs extends CustomQueueResource.Tag<Jobs>()("examples/CustomJobs", {
  payload: JobSchema,
  levelCount: 4,
  namedLevels: { interactive: 0, standard: 2, batch: 3 },
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
      CustomQueueResource.layerMemory(Jobs, {
        levelCount: 4,
        namedLevels: { interactive: 0, standard: 2, batch: 3 },
        takeAlgorithm: "weighted",
        concurrency: 2,
        effect: (job) => Effect.logInfo(`processed ${job.id} (${job.kind})`),
        autoStart: true,
      }),
    ),
    Effect.scoped,
  ),
).catch(console.error);

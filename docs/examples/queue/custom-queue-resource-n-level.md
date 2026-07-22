{#custom-queue-resource-n-level title="CustomQueue — N-Level Lanes" status="draft" appliesTo=all}
# CustomQueue — N-Level Lanes

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/forms/queue/custom-queue-resource-n-level.ts`](https://github.com/NikScripts/effect-pm/blob/integration/examples/forms/queue/custom-queue-resource-n-level.ts)  
**Run:** `pnpm run example:custom-queue-resource`  
**Hub:** [Examples → Queue](/docs/examples#queue)

`CustomQueueResource` — N named lanes, `add(item, level?)`, and `sizes: Record<string, number>`.

{.twoslash}
``` ts
import { Effect, Schema } from "effect"
import { CustomQueueResource } from "hyperlink-ts"

const JobSchema = Schema.Struct({ id: Schema.String, kind: Schema.String })

/** Tag factory: config object — `{ payload, levelCount, namedLevels? }`. */
class Jobs extends CustomQueueResource.Tag<Jobs>()("examples/CustomJobs", {
  payload: JobSchema,
  levelCount: 4,
  namedLevels: { interactive: 0, standard: 2, batch: 3 },
}) {}

const program = Effect.gen(function* () {
  const queue = yield* Jobs

  // Pair-style add — level is a configured name or numeric index.
  yield* queue.add({ id: "a", kind: "email" }, "interactive")
  yield* queue.add({ id: "b", kind: "report" }, "batch")
  yield* queue.add([{ id: "c", kind: "email" }, { id: "d", kind: "email" }], 2)

  const sizes = (yield* queue.status.get).sizes
  yield* Effect.log(
    `sizes: ${Object.entries(sizes)
      .map(([k, n]) => `${k}=${String(n)}`)
      .join(", ")}`,
  )

  const levelSizes = yield* queue.levelSizes
  yield* Effect.log(`levelSizes: ${levelSizes.join(", ")}`)
})

void Effect.runPromise(
  program.pipe(
    Effect.provide(
      CustomQueueResource.layer(Jobs, {
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
)
```

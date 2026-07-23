{#workpool-priority-lanes title="WorkPool Priority — N Lanes" status="draft" appliesTo=all}
# WorkPool Priority — N Lanes

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/forms/queue/workpool-priority-lanes.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/forms/queue/workpool-priority-lanes.ts)  
**Run:** `pnpm run example:custom-queue-hyperlink`  
**Hub:** [Examples → Queue](/docs/examples#queue)

`WorkPool` — N named lanes, `add(item, level?)`, and `sizes: Record<string, number>`.

{.twoslash}
``` ts
import { Effect, Schema } from "effect"
import { WorkPool } from "hyperlink-ts"

const JobSchema = Schema.Struct({ id: Schema.String, kind: Schema.String })

/** Tag factory: config object — `{ payload, laneCount, namedLanes? }`. */
class Jobs extends WorkPool.priority<Jobs>()("examples/CustomJobs", {
  payload: JobSchema,
  laneCount: 4,
  namedLanes: { interactive: 0, standard: 2, batch: 3 },
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
      WorkPool.layer(Jobs, {
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
)
```

{#workpool-priority-lanes title="WorkPool — Priority Lanes" status="draft" appliesTo=all}
# WorkPool — Priority Lanes

{.draft}
**Draft** — paired with a runnable example; tip-check before treating as SSOT.

**Source:** [`examples/forms/queue/workpool-priority-lanes.ts`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/forms/queue/workpool-priority-lanes.ts)  
**Run:** `pnpm run example:workpool-priority`  
**Hub:** [Examples → Queue](/docs/examples#queue)

`WorkPool` — N named lanes, `add(item, lane?)`, and `sizes: Record<string, number>`.

{.twoslash}
``` ts
// @noErrors
// KNOWN QUIRK: this block typechecks clean under dev, tsx, and scripts/check-twoslash.ts, but
// errors (2488/2345/7006) ONLY inside the bundled waku-build prerender — with typescript/twoslash
// externalized, so it is not the dual-instance problem. Sole holdout of the 2026-07 sweep;
// diagnose separately, then remove this directive.
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

  // Pair-style add — lane is a configured name or numeric index.
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
)
```

/**
 * RunResource — concurrency gate for effects.
 *
 * Wraps any effect with bounded concurrency via `Semaphore`. Unlike
 * {@link QueueResource}, there are no queues, priorities, or background workers —
 * the gate is applied inline at the call site. Each call to the gate acquires
 * a permit, executes the effect, and releases the permit on completion.
 *
 * ## Entry points
 *
 * | Function | Purpose |
 * |----------|---------|
 * | `RunResource.make` | Scoped Effect producing a gated callable |
 * | `RunResource.layer` | Builds a `Layer` from tag + config |
 * | `RunResource.Service` | Class factory: tag + baked-in `.layer` |
 * | `RunResource.Tag` | Class factory: pure identity tag (no layer) |
 * | `RunResource.makeRunner` | Generic runner (wraps arbitrary effects) |
 *
 * ## Usage
 *
 * ```ts
 * import { Effect } from "effect"
 * import { RunResource } from "@nikscripts/effect-pm"
 *
 * // Create a gated callable with concurrency 3
 * const program = Effect.scoped(
 *   Effect.gen(function*() {
 *     const fetchPrices = yield* RunResource.make({
 *       name: "@app/FetchPrices",
 *       effect: (symbol: string) => httpClient.get(`/prices/${symbol}`),
 *       concurrency: 3,
 *     })
 *
 *     // Up to 3 concurrent requests; additional calls block until a slot opens
 *     const [aapl, goog, msft] = yield* Effect.all(
 *       [fetchPrices("AAPL"), fetchPrices("GOOG"), fetchPrices("MSFT")],
 *       { concurrency: "unbounded" },
 *     )
 *   })
 * )
 * ```
 *
 * ## Architecture
 *
 * - **Semaphore** with `concurrency` permits controls max parallel executions
 * - Each call to the gate acquires 1 permit, runs the inner effect, releases on exit
 * - The semaphore is allocated once (scoped) and shared across all call sites
 * - No background fibers, no state management beyond the semaphore
 *
 * ## Runtime observation (optional)
 *
 * {@link RunResource.make}, {@link RunResource.layer}, and {@link RunResource.Service}
 * publish per-run facts and `RunResourceState` transitions through
 * {@link RunResourceHubTelemetry} (`R = TelemetryRouter`). Persist optionally
 * via {@link ArchiveSink.layerForStore | RunResourceArchiveSinkLayer} at app
 * compose time; emit succeeds with router only and zero sinks.
 *
 * {@link RunResource.makeRunner} does **not** emit observations — use `make`
 * when you need per-run analytics.
 *
 * ### In-process listeners (no durability)
 *
 * Provide a custom service whose shape matches
 * {@link RunResourceStore.Type} via `Effect.provideService` /
 * `Layer.succeed` and fan out to your callbacks inside each method. A
 * planned future feature (`RunResourceStore.live(resourceId)`)
 * will replace this pattern with a proper `Stream` subscription.
 *
 * **Durable run history (compose at app / `ProcessGroup.localEnvLayer`):**
 *
 * ```ts
 * import { ProcessStore } from "@nikscripts/effect-pm"
 * import { layerProcessStore } from "@nikscripts/effect-pm/storage/sqlite"
 *
 * const live = layerProcessStore({ filename: ".effect-pm/data.sqlite" })
 * // or ProcessStorage.layer for in-memory dev
 * ```
 *
 * Query persisted runs via {@link RunResourceStore}:
 *
 * ```ts
 * import { RunResourceStore } from "@nikscripts/effect-pm/store/RunResource"
 *
 * const runs = yield* RunResourceStore
 * yield* runs.facts({ resourceId: "@app/FetchPrices" })
 * yield* runs.runs("@app/FetchPrices") // paired started+ended history
 * ```
 *
 * @see {@link RunResourceStore} for durable read/query after compose.
 *
 * @module RunResourceModule
 */

export type {
  RunGate,
  RunResourceApi,
  RunResourceConfig,
  RunResourceDefinition,
  RunResourceMetadata,
  RunResourceRunner,
  RunResourceRunnerConfig,
  RunResourceRunnerDefinition,
  RunResourceServiceDefinition,
  RunResourceTagDefinition,
} from "./internal/runResource/service";

/**
 * Re-exports of the {@link RunResourceStore} facet's domain types
 * for convenience at the consumer module boundary. The owning module is
 * {@link store/RunResource} — import from
 * `@nikscripts/effect-pm/store/RunResource` if you only need types.
 *
 * @public
 */
export type {
  RunResourceFact,
  RunResourceFactType,
  RunResourceRunCompletedFact,
  RunResourceRunCompletedPayload,
  RunResourceRunFailedFact,
  RunResourceRunFailedPayload,
  RunResourceRunStartedFact,
  RunResourceRunStartedPayload,
  RunResourceState,
  RunResourceStateChange,
  RunResourceStateChangeReason,
} from "./internal/runResource/service";

export { RunResource, runResourceLayer } from "./internal/runResource/kernel";

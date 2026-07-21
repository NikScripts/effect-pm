/**
 * @module examples/forms/resource/node-identity-coordinator
 *
 * **One brain, many hands** — identity {@link Router} (exclusive) + N {@link Worker}s
 * (directory advertise) + Lookup. Router enqueues; a Worker runs the job.
 *
 * Handoff: `docs/handoffs/identity-coordinator.md` (M4).
 *
 * ```bash
 * pnpm exec tsx examples/forms/resource/node-identity-coordinator.ts
 * ```
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Effect, Layer, Schema } from "effect"
import * as Lookup from "../../../src/Lookup"
import * as Node from "../../../src/Node"
import * as Resource from "../../../src/Resource"

const Job = Schema.Struct({
  id: Schema.String,
  payload: Schema.String,
})

/** Exclusive coordinator — only one live winner via Lookup Identity. */
class Router extends Resource.Tag<Router>()("forms/Router", {
  enqueue: Resource.effectFn({ job: Job }, Schema.Void),
}).pipe(Resource.identity) {}

/** Many hands — advertise via Directory; dial with lookupClient. */
class Worker extends Resource.Tag<Worker>()("forms/Worker", {
  run: Resource.effectFn({ job: Job }, Schema.String),
}) {}

const program = Effect.gen(function* () {
  const lookupPath = `/tmp/effect-pm-forms-coord-lookup-${process.pid}.sock`
  const routerPath = `/tmp/effect-pm-forms-coord-router-${process.pid}.sock`

  // Hold one Lookup server for the whole demo; everyone else dials.
  yield* Layer.build(Lookup.layerOptions({ path: lookupPath, unlink: true }))
  const lookup = Lookup.clientOptions({ path: lookupPath })

  class RouterNode extends Node.Tag<RouterNode>()("forms/RouterNode", {
    path: routerPath,
  }) {}

  const workerImpl = {
    run: ({ job }: { readonly job: Schema.Schema.Type<typeof Job> }) =>
      Effect.succeed(`done:${job.id}:${job.payload}`),
  }

  // Hands: nameless unix listens advertise Worker under Lookup Directory.
  yield* Layer.build(
    Node.unix([Resource.serve(Worker, workerImpl)]).pipe(Layer.provide(lookup)),
  )
  yield* Layer.build(
    Node.unix([Resource.serve(Worker, workerImpl)]).pipe(Layer.provide(lookup)),
  )

  // Dial any advertised Worker (D4 pick) — closed over by the Router impl.
  const workerCtx = yield* Layer.build(
    Resource.lookupClient(Worker, { pick: "first" }).pipe(Layer.provide(lookup)),
  )

  // Brain: identity Router claims at Lookup; enqueue dials a Worker hand.
  const routerCtx = yield* Layer.build(
    Node.unix(RouterNode, [
      Resource.serve(Router, {
        enqueue: ({ job }: { readonly job: Schema.Schema.Type<typeof Job> }) =>
          Effect.gen(function* () {
            const worker = yield* Worker
            const result = yield* worker.run({ job })
            yield* Effect.logInfo(`router enqueue → ${result}`)
          }).pipe(Effect.provide(workerCtx)),
      }),
    ]).pipe(Layer.provide(lookup)),
  )

  yield* Effect.gen(function* () {
    const routerSvc = yield* Router
    yield* routerSvc.enqueue({
      job: { id: "1", payload: "hello" },
    })
  }).pipe(Effect.provide(routerCtx))

  yield* Effect.logInfo(
    "identity coordinator ok — Router (identity) + 2 Workers (directory)",
  )
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer))

NodeRuntime.runMain(program)

/**
 * @module examples/forms/resource/node-identity-coordinator
 *
 * **One brain, many hands** — identity {@link Router} (exclusive) + N {@link Worker}s
 * (directory advertise) + Lookup placement advice. Router publishes prefer, then
 * enqueues; the advised Worker runs the job.
 *
 * Handoff: `docs/handoffs/identity-coordinator.md` (M4 + M5).
 *
 * ```bash
 * pnpm exec tsx examples/forms/resource/node-identity-coordinator.ts
 * ```
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Context, Effect, Layer, Schema } from "effect"
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
  const lookupCtx = yield* Layer.build(lookup)

  class RouterNode extends Node.Tag<RouterNode>()("forms/RouterNode", {
    path: routerPath,
  }) {}

  // Hands: distinct impls so advice can target worker B.
  const workerA = yield* Layer.build(
    Node.unix([
      Resource.serve(Worker, {
        run: ({ job }: { readonly job: Schema.Schema.Type<typeof Job> }) =>
          Effect.succeed(`A:${job.id}`),
      }),
    ]).pipe(Layer.provide(lookup)),
  )
  const workerB = yield* Layer.build(
    Node.unix([
      Resource.serve(Worker, {
        run: ({ job }: { readonly job: Schema.Schema.Type<typeof Job> }) =>
          Effect.succeed(`B:${job.id}`),
      }),
    ]).pipe(Layer.provide(lookup)),
  )

  const preferB = Context.get(workerB, Node.ListenNode).key
  yield* Lookup.prefer(Worker, preferB).pipe(Effect.provide(lookupCtx))

  // Bare lookupClient — M5 honors advice (no D4 pick needed).
  const workerCtx = yield* Layer.build(
    Resource.lookupClient(Worker).pipe(Layer.provide(lookup)),
  )

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

  // keep worker A scope alive (B is dialed via advice)
  yield* Effect.sync(() => workerA)

  yield* Effect.logInfo(
    "identity coordinator ok — Router advised Worker B via Lookup.Advice",
  )
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer))

NodeRuntime.runMain(program)

/**
 * @module examples/forms/resource/node-tag-bound
 *
 * Tag carries the node — `Node.unix(Jobs, impl)` + `Resource.client(Jobs)`.
 *
 * ```bash
 * pnpm exec tsx examples/forms/resource/node-tag-bound.ts
 * ```
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Context, Effect, Layer, Schema } from "effect"
import * as Node from "../../../src/Node"
import * as Resource from "../../../src/Resource"

class Worker extends Node.Tag<Worker>()("forms/bound/Worker", {
  path: `/tmp/effect-pm-forms-bound-${process.pid}.sock`,
}) {}

class Jobs extends Resource.Tag<Jobs>()("forms/bound/Jobs", {
  jobs: Resource.effect(Schema.Number),
}).pipe(Resource.andNode(Worker)) {}

const program = Effect.gen(function* () {
  const serverCtx = yield* Layer.build(
    Node.unix(Jobs, { jobs: Effect.succeed(7) }),
  )
  const clientCtx = yield* Layer.build(Resource.client(Jobs))
  const n = yield* Effect.gen(function* () {
    const jobs = yield* Jobs
    return yield* jobs.jobs
  }).pipe(Effect.provide(Context.merge(serverCtx, clientCtx)))
  yield* Effect.logInfo(`jobs=${n}`)
  return n
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer))

NodeRuntime.runMain(
  program.pipe(
    Effect.flatMap((n) =>
      n === 7 ? Effect.void : Effect.die(new Error(`expected 7, got ${n}`)),
    ),
  ),
)

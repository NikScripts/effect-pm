/**
 * @module examples/forms/resource/node-tag-addressed
 *
 * **Node.Tag with a fixed address** — `{ path }` ⇒ IpcSocket.
 *
 * ```bash
 * pnpm exec tsx examples/forms/resource/node-tag-addressed.ts
 * ```
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Effect, Layer, Schema } from "effect"
import * as Node from "../../../src/Node"
import * as Resource from "../../../src/Resource"

class Jobs extends Resource.Tag<Jobs>()("forms/Jobs", {
  jobs: Resource.effect(Schema.Number),
}) {}

class Worker extends Node.Tag<Worker, Jobs>()("forms/Worker", {
  path: `/tmp/effect-pm-forms-node-tag-addressed-${process.pid}.sock`,
}) {}

const program = Effect.gen(function* () {
  const server = Node.unix(Worker, [
    Resource.serve(Jobs, { jobs: Effect.succeed(7) }),
  ])
  const serverCtx = yield* Layer.build(server)
  void serverCtx
  // AddressedNode → client auto-wires Node.connect(Worker)
  const client = Resource.client(Jobs, Worker)
  const n = yield* Jobs.pipe(
    Effect.flatMap((jobs) => jobs.jobs),
    Effect.provide(client),
  )
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

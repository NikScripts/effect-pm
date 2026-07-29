/**
 * @module examples/forms/hyperlink/node-tag-addressed
 *
 * **Node.Tag with a fixed address** — `{ path }` ⇒ IpcSocket.
 *
 * ```bash
 * pnpm exec tsx examples/forms/hyperlink/node-tag-addressed.ts
 * ```
 *
 * Docs: `docs/examples/hyperlink/node-tag-addressed.md` includes this file;
 * cut markers hide the module header and runner epilogue.
 */

// ---cut---
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Effect, Layer, Schema } from "effect"
import * as Node from "../../../src/Node"
import * as Hyperlink from "../../../src/Hyperlink"

class Jobs extends Hyperlink.Tag<Jobs>()("forms/Jobs", {
  jobs: Hyperlink.effect(Schema.Number),
}) {}

class Worker extends Node.Tag<Worker, Jobs>()("forms/Worker", {
  path: `/tmp/hyperlink-ts-forms-node-tag-addressed-${process.pid}.sock`,
}) {}

const program = Effect.gen(function* () {
  const server = Node.unix(Worker, [
    Hyperlink.serve(Jobs, { jobs: Effect.succeed(7) }),
  ])
  const serverCtx = yield* Layer.build(server)
  void serverCtx
  // AddressedNode → client auto-wires Node.connect(Worker)
  const client = Hyperlink.client(Jobs, Worker)
  const n = yield* Jobs.pipe(
    Effect.flatMap((jobs) => jobs.jobs),
    Effect.provide(client),
  )
  yield* Effect.logInfo(`jobs=${n}`)
  return n
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer))

// ---cut-after---
NodeRuntime.runMain(
  program.pipe(
    Effect.flatMap((n) =>
      n === 7 ? Effect.void : Effect.die(new Error(`expected 7, got ${n}`)),
    ),
  ),
)

/**
 * @module examples/forms/hyperlink/node-tag-bound
 *
 * Tag carries the node — `Node.unix(Jobs, impl)` + `Hyperlink.client(Jobs)`.
 *
 * ```bash
 * pnpm exec tsx examples/forms/hyperlink/node-tag-bound.ts
 * ```
 *
 * Docs: `docs/examples/hyperlink/node-tag-bound.md` includes this file;
 * cut markers hide the module header and runner epilogue.
 */

// ---cut---
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Context, Effect, Layer, Schema } from "effect"
import * as Node from "../../../src/Node"
import * as Hyperlink from "../../../src/Hyperlink"

class Worker extends Node.Tag<Worker>()("forms/bound/Worker", {
  path: `/tmp/hyperlink-ts-forms-bound-${process.pid}.sock`,
}) {}

class Jobs extends Hyperlink.Tag<Jobs>()("forms/bound/Jobs", {
  jobs: Hyperlink.effect(Schema.Number),
}).pipe(Hyperlink.andNode(Worker)) {}

const program = Effect.gen(function* () {
  const serverCtx = yield* Layer.build(
    Node.unix(Jobs, { jobs: Effect.succeed(7) }),
  )
  const clientCtx = yield* Layer.build(Hyperlink.client(Jobs))
  const n = yield* Effect.gen(function* () {
    const jobs = yield* Jobs
    return yield* jobs.jobs
  }).pipe(Effect.provide(Context.merge(serverCtx, clientCtx)))
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

/**
 * @module examples/forms/resource/node-tag-addressless-serve
 *
 * **Address-less Node.Tag — serve terminal.** Mints ipc + claims at Lookup.
 * Lookup is **piped** on (not `lookupPath` listen opts).
 *
 * Terminal A:
 * ```bash
 * LOOKUP_SOCK=/tmp/effect-pm-forms-addressless.sock \\
 *   pnpm exec tsx examples/forms/resource/node-tag-addressless-serve.ts
 * ```
 *
 * Terminal B: `node-tag-addressless-call.ts`
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Config, Effect, Layer, Schema } from "effect"
import * as Lookup from "../../../src/Lookup"
import * as Node from "../../../src/Node"
import * as Resource from "../../../src/Resource"

class Jobs extends Resource.Tag<Jobs>()("forms/Jobs", {
  jobs: Resource.effect(Schema.Number),
}) {}

/** Address-less — `Node.unix` mints path + claims this key. */
class Worker extends Node.Tag<Worker, Jobs>()("forms/AddresslessWorker") {}

const lookupSock = Config.string("LOOKUP_SOCK").pipe(
  Config.withDefault("/tmp/effect-pm-forms-addressless.sock"),
)

const program = Effect.gen(function* () {
  const path = yield* lookupSock
  const live = Node.unix(
    Worker,
    [Resource.serve(Jobs, { jobs: Effect.succeed(42) })],
  ).pipe(
    Layer.provide(
      Lookup.bootstrapDefaultLocal({ path, unlink: true }),
    ),
  )

  yield* Layer.build(live)
  yield* Effect.logInfo(`serve ready Lookup=${path} (holding until interrupt)`)
  return yield* Effect.never
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer))

NodeRuntime.runMain(program as Effect.Effect<never, unknown, never>)

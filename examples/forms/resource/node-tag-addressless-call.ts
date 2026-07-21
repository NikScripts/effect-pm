/**
 * @module examples/forms/resource/node-tag-addressless-call
 *
 * **Address-less Node.Tag — call terminal.** Resolves via Lookup + `discoverClient`.
 *
 * Terminal B (after serve is up):
 * ```bash
 * LOOKUP_SOCK=/tmp/effect-pm-forms-addressless.sock \\
 *   pnpm exec tsx examples/forms/resource/node-tag-addressless-call.ts
 * ```
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Config, Effect, Schema } from "effect"
import * as Resource from "../../../src/Resource"

class Jobs extends Resource.Tag<Jobs>()("forms/Jobs", {
  jobs: Resource.effect(Schema.Number),
}) {}

const lookupSock = Config.string("LOOKUP_SOCK").pipe(
  Config.withDefault("/tmp/effect-pm-forms-addressless.sock"),
)

const program = Effect.gen(function* () {
  const path = yield* lookupSock
  // Give the serve process a moment if started in parallel.
  yield* Effect.sleep("200 millis")
  const jobs = yield* Jobs.pipe(
    Effect.provide(Resource.discoverClient(Jobs, { lookupPath: path })),
  )
  const n = yield* jobs.jobs
  yield* Effect.logInfo(`jobs=${n}`)
  return n
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer))

NodeRuntime.runMain(
  program.pipe(
    Effect.flatMap((n) =>
      n === 42 ? Effect.void : Effect.die(new Error(`expected 42, got ${n}`)),
    ),
  ),
)

/**
 * @module examples/forms/resource/node-nameless-listen-call
 *
 * **Nameless address-less listen — call terminal.** Second runtime: no node
 * address hardcoded — `Resource.clientLocal` resolves both resources via Lookup
 * directory advertise from the nameless serve process.
 *
 * Terminal B (after serve is up):
 * ```bash
 * LOOKUP_SOCK=/tmp/effect-pm-forms-nameless.sock \\
 *   pnpm exec tsx examples/forms/resource/node-nameless-listen-call.ts
 * ```
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Config, Effect, Layer, Schema } from "effect"
import * as Resource from "../../../src/Resource"

class Jobs extends Resource.Tag<Jobs>()("forms/nameless/Jobs", {
  jobs: Resource.effect(Schema.Number),
}) {}

class Emails extends Resource.Tag<Emails>()("forms/nameless/Emails", {
  emails: Resource.effect(Schema.String),
}) {}

const lookupSock = Config.string("LOOKUP_SOCK").pipe(
  Config.withDefault("/tmp/effect-pm-forms-nameless.sock"),
)

const program = Effect.gen(function* () {
  const path = yield* lookupSock
  // Serve may still be advertising — brief settle.
  yield* Effect.sleep("300 millis")

  const clients = Layer.mergeAll(
    Resource.clientLocal(Jobs, { lookupPath: path, unlink: false }),
    Resource.clientLocal(Emails, { lookupPath: path, unlink: false }),
  )

  const pair = yield* Effect.gen(function* () {
    const jobs = yield* Jobs
    const emails = yield* Emails
    return [yield* jobs.jobs, yield* emails.emails] as const
  }).pipe(Effect.provide(clients))

  yield* Effect.logInfo(`jobs=${pair[0]} emails=${pair[1]}`)
  return pair
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer))

NodeRuntime.runMain(
  program.pipe(
    Effect.flatMap(([n, s]) =>
      n === 7 && s === "ok"
        ? Effect.logInfo("nameless cross-runtime ok")
        : Effect.die(new Error(`expected [7,"ok"], got ${JSON.stringify([n, s])}`)),
    ),
  ),
)

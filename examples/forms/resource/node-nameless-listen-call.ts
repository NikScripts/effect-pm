/**
 * @module examples/forms/resource/node-nameless-listen-call
 *
 * **Nameless listen — call terminal.** Second runtime: `clientLocal` resolves
 * both resources via the default Lookup (no node address, no Lookup path).
 *
 * Terminal B (after serve is up):
 * ```bash
 * pnpm exec tsx examples/forms/resource/node-nameless-listen-call.ts
 * ```
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Effect, Layer, Schema } from "effect"
import * as Resource from "../../../src/Resource"

class Jobs extends Resource.Tag<Jobs>()("forms/nameless/Jobs", {
  jobs: Resource.effect(Schema.Number),
}) {}

class Emails extends Resource.Tag<Emails>()("forms/nameless/Emails", {
  emails: Resource.effect(Schema.String),
}) {}

const program = Effect.gen(function* () {
  yield* Effect.sleep("300 millis")

  const clients = Layer.mergeAll(
    Resource.clientLocal(Jobs),
    Resource.clientLocal(Emails),
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
        : Effect.die(
            new Error(`expected [7,"ok"], got ${JSON.stringify([n, s])}`),
          ),
    ),
  ),
)

/**
 * @module examples/forms/resource/node-nameless-listen-call
 *
 * Nameless listen — call (second process).
 *
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

const clients = Layer.mergeAll(
  Resource.clientLocal(Jobs),
  Resource.clientLocal(Emails),
)

const program = Effect.gen(function* () {
  const jobs = yield* Jobs
  const emails = yield* Emails
  const n = yield* jobs.jobs
  const s = yield* emails.emails
  yield* Effect.logInfo(`jobs=${n} emails=${s}`)
}).pipe(Effect.provide(clients), Effect.scoped, Effect.provide(NodeServices.layer))

NodeRuntime.runMain(program)

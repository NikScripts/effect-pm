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
import { Effect, Schema } from "effect"
import * as Hyperlink from "../../../src/Hyperlink"

class Jobs extends Hyperlink.Tag<Jobs>()("forms/nameless/Jobs", {
  jobs: Hyperlink.effect(Schema.Number),
}) {}

class Emails extends Hyperlink.Tag<Emails>()("forms/nameless/Emails", {
  emails: Hyperlink.effect(Schema.String),
}) {}

const clients = Hyperlink.discoverClients(Jobs, Emails)

const program = Effect.gen(function* () {
  const jobs = yield* Jobs
  const emails = yield* Emails
  const n = yield* jobs.jobs
  const s = yield* emails.emails
  yield* Effect.logInfo(`jobs=${n} emails=${s}`)
}).pipe(Effect.provide(clients), Effect.scoped, Effect.provide(NodeServices.layer))

NodeRuntime.runMain(program)

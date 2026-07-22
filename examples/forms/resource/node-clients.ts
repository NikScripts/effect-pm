/**
 * @module examples/forms/resource/node-clients
 *
 * **Catalog Node + `Node.clients`** — one Worker advertises `Jobs | Emails`;
 * the client dials both without repeating `connect`.
 *
 * ```bash
 * pnpm exec tsx examples/forms/resource/node-clients.ts
 * ```
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Context, Effect, Layer, Schema } from "effect"
import * as Node from "../../../src/Node"
import * as Hyperlink from "../../../src/Hyperlink"

class Jobs extends Hyperlink.Tag<Jobs>()("forms/clients/Jobs", {
  jobs: Hyperlink.effect(Schema.Number),
}) {}

class Emails extends Hyperlink.Tag<Emails>()("forms/clients/Emails", {
  emails: Hyperlink.effect(Schema.String),
}) {}

class Worker extends Node.Tag<Worker, Jobs | Emails>()("forms/clients/Worker", {
  path: `/tmp/hyperlink-ts-forms-clients-${process.pid}.sock`,
}) {}

const program = Effect.gen(function* () {
  const serverCtx = yield* Layer.build(
    Node.unix(Worker, [
      Hyperlink.serve(Jobs, { jobs: Effect.succeed(7) }),
      Hyperlink.serve(Emails, { emails: Effect.succeed("ok") }),
    ]),
  )
  // Array or rest — tags must cover Worker's ROut.
  const clientCtx = yield* Layer.build(Node.clients(Worker, [Jobs, Emails]))

  const pair = yield* Effect.gen(function* () {
    const jobs = yield* Jobs
    const emails = yield* Emails
    return [yield* jobs.jobs, yield* emails.emails] as const
  }).pipe(Effect.provide(Context.merge(serverCtx, clientCtx)))

  yield* Effect.logInfo(`jobs=${pair[0]} emails=${pair[1]}`)
  return pair
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer))

NodeRuntime.runMain(
  program.pipe(
    Effect.flatMap((pair) =>
      pair[0] === 7 && pair[1] === "ok"
        ? Effect.void
        : Effect.die(new Error(`unexpected ${JSON.stringify(pair)}`)),
    ),
  ),
)

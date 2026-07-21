/**
 * @module examples/forms/resource/node-clients-for
 *
 * **Catalog Node + `Node.clientsFor`** — one Worker advertises `Jobs | Emails`;
 * the client dials both without repeating `connect`.
 *
 * ```bash
 * pnpm exec tsx examples/forms/resource/node-clients-for.ts
 * ```
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Context, Effect, Layer, Schema } from "effect"
import * as Node from "../../../src/Node"
import * as Resource from "../../../src/Resource"

class Jobs extends Resource.Tag<Jobs>()("forms/clientsFor/Jobs", {
  jobs: Resource.effect(Schema.Number),
}) {}

class Emails extends Resource.Tag<Emails>()("forms/clientsFor/Emails", {
  emails: Resource.effect(Schema.String),
}) {}

class Worker extends Node.Tag<Worker, Jobs | Emails>()(
  "forms/clientsFor/Worker",
  {
    path: `/tmp/effect-pm-forms-clients-for-${process.pid}.sock`,
  },
) {}

const program = Effect.gen(function* () {
  const serverCtx = yield* Layer.build(
    Node.unix(Worker, [
      Resource.serve(Jobs, { jobs: Effect.succeed(7) }),
      Resource.serve(Emails, { emails: Effect.succeed("ok") }),
    ]),
  )
  // One bundled connect — tags must cover Worker's ROut.
  const clientCtx = yield* Layer.build(Node.clientsFor(Worker, Jobs, Emails))

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

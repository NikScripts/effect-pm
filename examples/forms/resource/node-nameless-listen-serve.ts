/**
 * @module examples/forms/resource/node-nameless-listen-serve
 *
 * **Nameless listen — serve terminal.** No `Node.Tag`, no Lookup path to pass:
 * `Node.listen([serve…])` mints an anonymous address-less node, claims at Lookup,
 * binds ipc, and bootstraps the default same-machine Lookup.
 *
 * Terminal A:
 * ```bash
 * pnpm exec tsx examples/forms/resource/node-nameless-listen-serve.ts
 * ```
 *
 * Terminal B: `node-nameless-listen-call.ts`
 *
 * Or one command (forks serve, then calls): `node-nameless-listen-demo.ts`
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Context, Effect, Layer, Schema } from "effect"
import * as Node from "../../../src/Node"
import * as Resource from "../../../src/Resource"

class Jobs extends Resource.Tag<Jobs>()("forms/nameless/Jobs", {
  jobs: Resource.effect(Schema.Number),
}) {}

class Emails extends Resource.Tag<Emails>()("forms/nameless/Emails", {
  emails: Resource.effect(Schema.String),
}) {}

const program = Effect.gen(function* () {
  // Defaults: Lookup at /tmp/effect-pm-lookup.sock — no options bag.
  const live = Node.listen([
    Resource.serve(Jobs, { jobs: Effect.succeed(7) }),
    Resource.serve(Emails, { emails: Effect.succeed("ok") }),
  ])

  const ctx = yield* Layer.build(live)
  const listenNode = Context.get(ctx, Node.ListenNode)
  yield* Effect.logInfo(
    `nameless serve ready node=${listenNode.key} path=${listenNode.path} (holding until interrupt)`,
  )
  return yield* Effect.never
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer))

NodeRuntime.runMain(program as Effect.Effect<never, unknown, never>)

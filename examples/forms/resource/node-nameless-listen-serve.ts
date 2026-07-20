/**
 * @module examples/forms/resource/node-nameless-listen-serve
 *
 * **Nameless address-less listen — serve terminal.** No `Node.Tag` to declare:
 * `Node.listen([serve…])` mints an anonymous address-less node, claims at Lookup,
 * binds ipc, and bootstraps default Lookup. Two resources on one runtime.
 *
 * Terminal A:
 * ```bash
 * LOOKUP_SOCK=/tmp/effect-pm-forms-nameless.sock \\
 *   pnpm exec tsx examples/forms/resource/node-nameless-listen-serve.ts
 * ```
 *
 * Terminal B: `node-nameless-listen-call.ts`
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Config, Context, Effect, Layer, Schema } from "effect"
import * as Node from "../../../src/Node"
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
  // No Worker Tag — nameless listen mints the node + Lookup bootstrap.
  const live = Node.listen(
    [
      Resource.serve(Jobs, { jobs: Effect.succeed(7) }),
      Resource.serve(Emails, { emails: Effect.succeed("ok") }),
    ],
    { lookupPath: path, unlinkLookup: true },
  )

  const ctx = yield* Layer.build(live)
  const listenNode = Context.get(ctx, Node.ListenNode)
  yield* Effect.logInfo(
    `nameless serve ready Lookup=${path} node=${listenNode.key} path=${listenNode.path} (holding until interrupt)`,
  )
  return yield* Effect.never
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer))

NodeRuntime.runMain(program as Effect.Effect<never, unknown, never>)

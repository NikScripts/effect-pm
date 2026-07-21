/**
 * @module examples/forms/resource/node-lookup
 *
 * **Node.asLookup** (brand a Tag node as the lookup server) + Lookup.bootstrapDefaultLocal / layer / client.
 *
 * ```bash
 * pnpm exec tsx examples/forms/resource/node-lookup.ts
 * ```
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Effect, Layer } from "effect"
import * as Lookup from "../../../src/Lookup"
import * as Node from "../../../src/Node"

const program = Effect.gen(function* () {
  const path = `/tmp/effect-pm-forms-lookup-${process.pid}.sock`
  const lookupNode = Node.Tag()("forms/Lookup", { path }).pipe(Node.asLookup)

  // bootstrap = bind-or-dial default-local style on an explicit path
  const boot = Lookup.bootstrapDefaultLocal({ path, unlink: true })
  yield* Layer.build(boot)

  // Explicit layer on the Lookup Node (same path — second binder loses; we already hold it)
  yield* Effect.logInfo(
    `Lookup Node key=${lookupNode.key} isLookup=${Node.isLookupNode(lookupNode)} path=${path}`,
  )

  // Client dials the same sock
  const client = Lookup.client(lookupNode)
  yield* Layer.build(client)
  yield* Effect.logInfo("Lookup.bootstrapDefaultLocal + client ok")
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer))

NodeRuntime.runMain(program)

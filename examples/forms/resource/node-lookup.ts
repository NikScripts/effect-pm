/**
 * @module examples/forms/resource/node-lookup
 *
 * **Node.asLookup** (brand a Tag node as the lookup server) + `Lookup.layerOptions` / `client`.
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

  // Bind-or-dial on an explicit path (default path is bare `Lookup.layer`)
  const boot = Lookup.layerOptions({ path, unlink: true })
  yield* Layer.build(boot)

  yield* Effect.logInfo(
    `Lookup Node key=${lookupNode.key} isLookup=${Node.isLookupNode(lookupNode)} path=${path}`,
  )

  const client = Lookup.client(lookupNode)
  yield* Layer.build(client)
  yield* Effect.logInfo("Lookup.layerOptions + client ok")
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer))

NodeRuntime.runMain(program)

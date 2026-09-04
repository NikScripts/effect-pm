/**
 * @module examples/node/as-lookup
 *
 * **(7) Node.asLookup** — brand a Tag node as the Lookup server, serve it with
 * {@link Lookup.layerNode}, dial with {@link Lookup.client}.
 *
 * Same-machine default bus (no Lookup node) is bare `Lookup.layer` — different story.
 * Walkthrough: see `examples/README.md` Node module path.
 *
 * ```bash
 * pnpm exec tsx examples/node/as-lookup.ts
 * ```
 *
 * Docs: `docs/examples/node/as-lookup.md` includes this file;
 * cut markers hide the module header and runner epilogue.
 */

// ---cut---
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Effect, Layer } from "effect"
import * as Lookup from "../../src/Lookup"
import * as Node from "../../src/Node"

const program = Effect.gen(function* () {
  const path = `/tmp/hyperlink-ts-forms-lookup-${process.pid}.sock`
  const lookupNode = Node.Service()("Lookup", { path }).pipe(Node.asLookup)

  // Exclusive serve on the branded node (not bind-or-dial beside it)
  yield* Layer.build(Lookup.layerNode(lookupNode, { unlink: true }))

  yield* Effect.logInfo(
    `Lookup Node key=${lookupNode.key} isLookup=${Node.isLookupNode(lookupNode)} path=${path}`,
  )

  const client = Lookup.client(lookupNode)
  yield* Layer.build(client)
  yield* Effect.logInfo("Lookup.layerNode + client ok")
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer))

// ---cut-after---
NodeRuntime.runMain(program)

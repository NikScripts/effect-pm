/**
 * @module examples/forms/resource/node-ws-nameless-serve
 *
 * **(8b) Nameless `Node.ws(serve)`** — localhost WebSocket sibling of unix nameless (#5).
 * Lookup **piped** (same contract as protocol listen siblings).
 *
 * ```bash
 * pnpm exec tsx examples/forms/resource/node-ws-nameless-serve.ts
 * ```
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Effect, Layer, Schema } from "effect"
import * as Lookup from "../../../src/Lookup"
import * as Node from "../../../src/Node"
import * as Resource from "../../../src/Resource"

class Jobs extends Resource.Tag<Jobs>()("forms/ws/Jobs", {
  jobs: Resource.effect(Schema.Number),
}) {}

const live = Node.ws(
  Resource.serve(Jobs, { jobs: Effect.succeed(7) }),
).pipe(Layer.provide(Lookup.layer))

NodeRuntime.runMain(
  Layer.launch(live).pipe(Effect.provide(NodeServices.layer)),
)

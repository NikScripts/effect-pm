/**
 * @module examples/forms/resource/node-http-nameless-serve
 *
 * Nameless `Node.http(serve)` — localhost Http + Lookup. No `Node.Tag`.
 *
 * ```bash
 * pnpm exec tsx examples/forms/resource/node-http-nameless-serve.ts
 * ```
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Effect, Layer, Schema } from "effect"
import * as Node from "../../../src/Node"
import * as Resource from "../../../src/Resource"

class Jobs extends Resource.Tag<Jobs>()("forms/http/Jobs", {
  jobs: Resource.effect(Schema.Number),
}) {}

const live = Node.http(Resource.serve(Jobs, { jobs: Effect.succeed(7) }))

NodeRuntime.runMain(
  Layer.launch(live).pipe(Effect.provide(NodeServices.layer)),
)

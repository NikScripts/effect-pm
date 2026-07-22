/**
 * @module examples/forms/resource/node-http-nameless-serve
 *
 * **(8a) Nameless `Node.http(serve)`** — localhost Http sibling of unix nameless (#5).
 * Lookup **piped** (same contract as protocol listen siblings).
 *
 * ```bash
 * pnpm exec tsx examples/forms/resource/node-http-nameless-serve.ts
 * ```
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Effect, Layer, Schema } from "effect"
import * as Lookup from "../../../src/Lookup"
import * as Node from "../../../src/Node"
import * as Hyperlink from "../../../src/Hyperlink"

class Jobs extends Hyperlink.Tag<Jobs>()("forms/http/Jobs", {
  jobs: Hyperlink.effect(Schema.Number),
}) {}

const live = Node.http(
  Hyperlink.serve(Jobs, { jobs: Effect.succeed(7) }),
).pipe(Layer.provide(Lookup.layer))

NodeRuntime.runMain(
  Layer.launch(live).pipe(Effect.provide(NodeServices.layer)),
)

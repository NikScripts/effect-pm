/**
 * @module examples/forms/resource/node-nameless-listen-serve
 *
 * Nameless listen — serve. No `Node.Tag`.
 *
 * ```bash
 * pnpm exec tsx examples/forms/resource/node-nameless-listen-serve.ts
 * ```
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Effect, Layer, Schema } from "effect"
import * as Node from "../../../src/Node"
import * as Resource from "../../../src/Resource"

class Jobs extends Resource.Tag<Jobs>()("forms/nameless/Jobs", {
  jobs: Resource.effect(Schema.Number),
}) {}

class Emails extends Resource.Tag<Emails>()("forms/nameless/Emails", {
  emails: Resource.effect(Schema.String),
}) {}

const live = Node.listen([
  Resource.serve(Jobs, { jobs: Effect.succeed(7) }),
  Resource.serve(Emails, { emails: Effect.succeed("ok") }),
])

NodeRuntime.runMain(
  Layer.launch(live).pipe(Effect.provide(NodeServices.layer)),
)

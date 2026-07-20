/**
 * @module examples/forms/resource/node-nameless-listen-tag
 *
 * Nameless listen — one resource as `listen(Tag, impl)` (no `Resource.serve`).
 *
 * ```bash
 * pnpm exec tsx examples/forms/resource/node-nameless-listen-tag.ts
 * ```
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Effect, Layer, Schema } from "effect"
import * as Node from "../../../src/Node"
import * as Resource from "../../../src/Resource"

class Jobs extends Resource.Tag<Jobs>()("forms/nameless-tag/Jobs", {
  jobs: Resource.effect(Schema.Number),
}) {}

const live = Node.listen(Jobs, { jobs: Effect.succeed(7) })

NodeRuntime.runMain(
  Layer.launch(live).pipe(Effect.provide(NodeServices.layer)),
)

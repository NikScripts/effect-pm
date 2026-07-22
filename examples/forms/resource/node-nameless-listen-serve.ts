/**
 * @module examples/forms/resource/node-nameless-listen-serve
 *
 * **(5) Nameless `Node.unix([serve…])`** — serve. No `Node.Tag`.
 * Lookup **piped** (claim / advertise). See also #8 http/ws siblings.
 *
 * ```bash
 * pnpm exec tsx examples/forms/resource/node-nameless-listen-serve.ts
 * ```
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Effect, Layer, Schema } from "effect"
import * as Lookup from "../../../src/Lookup"
import * as Node from "../../../src/Node"
import * as Hyperlink from "../../../src/Hyperlink"

class Jobs extends Hyperlink.Tag<Jobs>()("forms/nameless/Jobs", {
  jobs: Hyperlink.effect(Schema.Number),
}) {}

class Emails extends Hyperlink.Tag<Emails>()("forms/nameless/Emails", {
  emails: Hyperlink.effect(Schema.String),
}) {}

const live = Node.unix([
  Hyperlink.serve(Jobs, { jobs: Effect.succeed(7) }),
  Hyperlink.serve(Emails, { emails: Effect.succeed("ok") }),
]).pipe(Layer.provide(Lookup.layer))

NodeRuntime.runMain(
  Layer.launch(live).pipe(Effect.provide(NodeServices.layer)),
)

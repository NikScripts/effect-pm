/**
 * @module examples/forms/hyperlink/node-http-nameless-serve
 *
 * **(8a) Nameless `Node.http(serve)`** — localhost Http sibling of unix nameless (#5).
 * Lookup Soft-baked when Identity is absent (same as unix / ws / nPipe).
 *
 * ```bash
 * pnpm exec tsx examples/forms/hyperlink/node-http-nameless-serve.ts
 * ```
 *
 * Docs: `docs/examples/hyperlink/node-http-nameless-serve.md` includes this file;
 * cut markers hide the module header and runner epilogue.
 */

// ---cut---
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Effect, Layer, Schema } from "effect"
import * as Node from "../../../src/Node"
import * as Hyperlink from "../../../src/Hyperlink"

class Jobs extends Hyperlink.Tag<Jobs>()("forms/http/Jobs", {
  jobs: Hyperlink.effect(Schema.Number),
}) {}

const live = Node.http(
  Hyperlink.serve(Jobs, { jobs: Effect.succeed(7) }),
)

// ---cut-after---
NodeRuntime.runMain(
  Layer.launch(live).pipe(Effect.provide(NodeServices.layer)),
)

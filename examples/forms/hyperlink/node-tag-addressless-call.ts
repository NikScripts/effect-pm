/**
 * @module examples/forms/hyperlink/node-tag-addressless-call
 *
 * **Address-less Node.Tag — call terminal.** Lookup is **piped** onto
 * {@link Hyperlink.lookupClient} (same shape as the serve side).
 *
 * Terminal B (after serve is up):
 * ```bash
 * LOOKUP_SOCK=/tmp/hyperlink-ts-forms-addressless.sock \\
 *   pnpm exec tsx examples/forms/hyperlink/node-tag-addressless-call.ts
 * ```
 *
 * Docs: `docs/examples/hyperlink/node-tag-addressless-call.md` includes this file;
 * cut markers hide the module header and runner epilogue.
 */

// ---cut---
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Config, Effect, Layer, Schema } from "effect"
import * as Lookup from "../../../src/Lookup"
import * as Hyperlink from "../../../src/Hyperlink"

class Jobs extends Hyperlink.Tag<Jobs>()("forms/Jobs", {
  jobs: Hyperlink.effect(Schema.Number),
}) {}

const lookupSock = Config.string("LOOKUP_SOCK").pipe(
  Config.withDefault("/tmp/hyperlink-ts-forms-addressless.sock"),
)

const program = Effect.gen(function* () {
  const path = yield* lookupSock
  // Give the serve process a moment if started in parallel.
  yield* Effect.sleep("200 millis")
  const client = Hyperlink.lookupClient(Jobs).pipe(
    Layer.provide(
      Lookup.layerOptions({ path, unlink: false }),
    ),
  )
  const jobs = yield* Jobs.pipe(Effect.provide(client))
  const n = yield* jobs.jobs
  yield* Effect.logInfo(`jobs=${n}`)
  return n
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer))

// ---cut-after---
NodeRuntime.runMain(
  program.pipe(
    Effect.flatMap((n) =>
      n === 42 ? Effect.void : Effect.die(new Error(`expected 42, got ${n}`)),
    ),
  ),
)

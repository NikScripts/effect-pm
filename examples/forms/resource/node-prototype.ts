/**
 * @module examples/forms/resource/node-prototype
 *
 * **Node.Prototype** — `.make` named clone + `.listen(serves)` dynamic instance.
 * `.listen` dispatches to `unix` / `http` / `ws` / `nPipe` — keep in sync with those
 * siblings (handoff § Protocol listen siblings).
 *
 * ```bash
 * pnpm exec tsx examples/forms/resource/node-prototype.ts
 * ```
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Effect, Layer, Schema } from "effect"
import * as Lookup from "../../../src/Lookup"
import * as Node from "../../../src/Node"
import * as Resource from "../../../src/Resource"

class Mail extends Resource.Tag<Mail>()("forms/Mail", {
  pending: Resource.effect(Schema.Number),
}) {}

class MailWorker extends Node.Prototype<MailWorker, Mail>("forms/MailWorker") {}

const program = Effect.gen(function* () {
  const sock = `/tmp/effect-pm-forms-proto-${process.pid}.sock`
  const lookupPath = `/tmp/effect-pm-forms-proto-lookup-${process.pid}.sock`

  // Named clone with a fixed address
  class East extends MailWorker.make("East", { path: sock }) {}
  const lookup = Lookup.layerOptions({ path: lookupPath, unlink: true })
  const named = Node.unix(
    East,
    [Resource.serve(Mail, { pending: Effect.succeed(3) })],
  ).pipe(Layer.provide(lookup))

  // Dynamic instance — same Lookup pipe + protocol siblings as Node.unix / http / ws
  const spawn = MailWorker.listen([
    Resource.serve(Mail, { pending: Effect.succeed(9) }),
  ])
  const dynamic = spawn("w1").pipe(
    Layer.provide(Lookup.layerOptions({ path: lookupPath, unlink: false })),
  )

  yield* Layer.build(named)
  yield* Layer.build(dynamic)
  yield* Effect.logInfo("Prototype.make + Prototype.listen ok")
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer))

NodeRuntime.runMain(program)

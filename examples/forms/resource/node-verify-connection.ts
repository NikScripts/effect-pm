/**
 * @module examples/forms/resource/node-verify-connection
 *
 * **Eager node verify** — tier-1 reachability, then `{ deep: true }` node.status
 * classification (`ProtocolUnanswered` / `ServiceNotServed` / `ServiceNotReady`).
 *
 * ```bash
 * pnpm exec tsx examples/forms/resource/node-verify-connection.ts
 * ```
 */
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import { Effect, Layer, Schema } from "effect"
import { HttpServer } from "effect/unstable/http"
import * as Node from "../../../src/Node"
import * as Hyperlink from "../../../src/Hyperlink"

class Droplet extends Node.Tag<Droplet>()("forms/verify/Droplet") {}

class Emails extends Hyperlink.Tag<Emails>()("forms/verify/Emails", {
  ping: Hyperlink.effect(Schema.String),
}) {}

const Server = Node.httpServer([
  Hyperlink.serve(Emails, { ping: Effect.succeed("pong") }),
]).pipe(Layer.provideMerge(NodeHttpServer.layerTest))

const program = Effect.gen(function* () {
  const address = yield* HttpServer.HttpServer.pipe(Effect.map((s) => s.address))
  const port = address._tag === "TcpAddress" ? address.port : 0
  const url = `http://127.0.0.1:${port}/rpc`

  // Tier 1 — cheap transport probe (default).
  yield* Hyperlink.verifyConnection(Droplet, { url })
  // Deep — RPC node.status + require Emails ready.
  yield* Hyperlink.verifyConnection(Droplet, {
    url,
    deep: true,
    resource: "forms/verify/Emails",
  })
  yield* Effect.logInfo(`verify ok — ${url} serves Emails ready`)
}).pipe(Effect.provide(Server), Effect.scoped)

NodeRuntime.runMain(program as Effect.Effect<void, Effect.Error<typeof program>, never>)

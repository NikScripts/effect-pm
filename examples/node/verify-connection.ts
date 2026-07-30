/**
 * @module examples/node/verify-connection
 *
 * **Eager node verify** — free-standing `Hyperlink.verifyConnection` tiers, plus
 * addressed `Hyperlink.client` mode via `Policy.verify*` fragments.
 *
 * ```bash
 * pnpm run example:node-verify-connection
 * ```
 *
 * Guide: `docs/guides/client-verify.md` · `docs/guides/policy.md`.
 * Docs: `docs/examples/node/verify-connection.md`.
 */

// ---cut---
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import { Effect, Layer, Schema } from "effect"
import { HttpServer } from "effect/unstable/http"
import * as Node from "../../src/Node"
import * as Hyperlink from "../../src/Hyperlink"
import * as Policy from "../../src/Policy"

class Droplet extends Node.Tag<Droplet>()("verify/Droplet") {}

class Emails extends Hyperlink.Tag<Emails>()("verify/Emails", {
  ping: Hyperlink.effect(Schema.String),
}) {}

const Server = Node.httpServer([
  Hyperlink.serve(Emails, { ping: Effect.succeed("pong") }),
]).pipe(Layer.provideMerge(NodeHttpServer.layerTest))

const program = Effect.gen(function* () {
  const address = yield* HttpServer.HttpServer.pipe(Effect.map((s) => s.address))
  const port = address._tag === "TcpAddress" ? address.port : 0
  const url = `http://127.0.0.1:${port}/rpc`
  const node = Node.Tag()("verify/Droplet", { url, kind: "Http" })

  // Tier 1 — cheap transport probe (default).
  yield* Hyperlink.verifyConnection(Droplet, { url })
  // Deep — RPC node.status + require Emails ready.
  yield* Hyperlink.verifyConnection(Droplet, {
    url,
    deep: true,
    serviceKey: "verify/Emails",
  })
  yield* Effect.logInfo(`verifyConnection ok — ${url} serves Emails ready`)

  // Addressed client — default Policy.verifyReject (probe before handle usable).
  const clientCtx = yield* Layer.build(
    Hyperlink.client(Emails, node).pipe(Policy.provide(Policy.verifyReject)),
  )
  const pong = yield* Effect.gen(function* () {
    const emails = yield* Emails
    return yield* emails.ping
  }).pipe(Effect.provide(clientCtx))
  yield* Effect.logInfo(`Policy.verifyReject client ping → ${pong}`)

  // Nested / bootstrap dials opt out:
  yield* Layer.build(
    Hyperlink.client(Emails, node).pipe(Policy.provide(Policy.verifyOff)),
  )
  yield* Effect.logInfo("Policy.verifyOff — client Layer built without probe fail-closed")
}).pipe(Effect.provide(Server), Effect.scoped)

// ---cut-after---
NodeRuntime.runMain(program)

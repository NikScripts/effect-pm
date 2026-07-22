import { Context, Duration, Effect, Layer, Ref, Schema } from "effect";
import { HttpServer } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import { describe, it } from "@effect/vitest";
import { expect } from "vitest";
import * as Node from "../src/Node";
import * as Hyperlink from "../src/Hyperlink";

// Regression guard for multi-protocol nodes end-to-end: one `{ http, ws }` node served over BOTH
// transports must (1) boot on httpServer AND wsServer — the P3 `ProtocolKindMismatch` set-membership
// check — and (2) route a live client over each transport to the matching server. The example
// `examples/scenarios/multi-protocol-dual-serve.ts` is the narrated version; this locks it in CI.
// Real ephemeral ports (NodeHttpServer.layerTest), same as resource-verify-connection.test.ts.

class Fleet extends Node.Tag<Fleet>()("mps/fleet", {
  // urls are placeholders — P3 checks the KIND set, and the client dials the real ephemeral ports.
  http: "http://placeholder/rpc",
  ws: "ws://placeholder/rpc",
}) {}
// Bound to Fleet so each server runs the P3 check against Fleet's declared {Http, WebSocket} set.
class Bound extends Hyperlink.Tag<Bound>()(
  "mps/bound",
  { ping: Hyperlink.effect(Schema.Number) },
  { node: Fleet },
) {}
// The contract a remote dials with an explicit transport (nodeless — no auto-select / no memo).
class Wire extends Hyperlink.Tag<Wire>()("mps/wire", { ping: Hyperlink.effect(Schema.Number) }) {}

const noop = { ping: Effect.succeed(0) };
const portOf = (ctx: Context.Context<HttpServer.HttpServer>): number => {
  const address = Context.get(ctx, HttpServer.HttpServer).address;
  return address._tag === "TcpAddress" ? address.port : 0;
};

describe("multi-protocol node served over http + ws", () => {
  it.live("boots on both transports (P3) and routes a client over each", () =>
    Effect.gen(function* () {
      const httpHits = yield* Ref.make(0);
      const wsHits = yield* Ref.make(0);
      // transport-tagged replies: http → 100+n, ws → 200+n (wrong routing shows in the number).
      const httpWire = { ping: Ref.updateAndGet(httpHits, (n) => n + 1).pipe(Effect.map((n) => 100 + n)) };
      const wsWire = { ping: Ref.updateAndGet(wsHits, (n) => n + 1).pipe(Effect.map((n) => 200 + n)) };

      // Building each server = booting it. Both build ⇒ P3 held for Http AND WebSocket (a mismatch
      // would die here). Each `layerTest` binds its own ephemeral port.
      const httpCtx = yield* Layer.build(
        Node.httpServer([Hyperlink.serve(Bound, noop), Hyperlink.serve(Wire, httpWire)]).pipe(
          Layer.provideMerge(NodeHttpServer.layerTest),
        ),
      );
      const wsCtx = yield* Layer.build(
        Node.wsServer([Hyperlink.serve(Bound, noop), Hyperlink.serve(Wire, wsWire)]).pipe(
          Layer.provideMerge(NodeHttpServer.layerTest),
        ),
      );

      const call = (transport: Layer.Layer<import("effect/unstable/rpc").RpcClient.Protocol>) =>
        Effect.gen(function* () {
          const wire = yield* Wire;
          return yield* wire.ping;
        }).pipe(
          Effect.provide(Hyperlink.client(Wire).pipe(Layer.provide(Hyperlink.layerProtocol(transport)))),
          Effect.scoped,
        );

      const overHttp = yield* call(Hyperlink.protocolHttp(`http://127.0.0.1:${portOf(httpCtx)}/rpc`));
      const overWs = yield* call(Hyperlink.protocolWebsocket(`ws://127.0.0.1:${portOf(wsCtx)}/rpc`));

      // http landed only on the http server (101 = 100+1), ws only on the ws server (201 = 200+1).
      expect(overHttp).toBe(101);
      expect(overWs).toBe(201);
      expect(yield* Ref.get(httpHits)).toBe(1);
      expect(yield* Ref.get(wsHits)).toBe(1);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(15))),
  );
});

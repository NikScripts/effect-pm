/**
 * @module examples/scenarios/multi-protocol-dual-serve
 *
 * **Live proof: one multi-protocol node, served over http AND ws, round-tripped over each.**
 *
 * A single `{ http, ws }` node (`Fleet`) is served over BOTH transports in one process —
 * `Node.httpServer` on one port, `Node.wsServer` on another. Two things are proven:
 *
 * 1. **The multi-protocol node.** `Bound` is bound to `Fleet` and served on both servers. Both boot
 *    only because Http and WebSocket are each members of `Fleet`'s declared set — the P3
 *    `ProtocolKindMismatch` guard. Serving a single-protocol node over the wrong transport would die
 *    at boot; this one doesn't, on either.
 * 2. **Both transports are live.** `Wire` is the same contract dialed as a remote would — nodeless,
 *    transport supplied explicitly — so it can be round-tripped over http AND over ws from one
 *    process (a *node-bound* client resolves to one transport per process by design; the wire client
 *    is how a browser vs a server each pick their own). Each server tags its reply with its transport
 *    (http → 100+n, ws → 200+n) and counts hits, so a call landing on the wrong server is caught from
 *    both sides.
 *
 * Everything is scoped — servers are `Layer.build`-bound into the program scope and torn down with it.
 *
 * ```bash
 * pnpm exec tsx examples/scenarios/multi-protocol-dual-serve.ts
 * ```
 *
 * Docs: `docs/examples/scenarios/multi-protocol-dual-serve.md` includes this file;
 * cut markers hide the module header and runner epilogue.
 */

// ---cut---
// @effect-diagnostics-next-line nodeBuiltinImport:off
import { createServer } from "node:http";
import { Effect, Layer, Ref, Schema } from "effect";
import type { RpcClient } from "effect/unstable/rpc";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as Node from "../../src/Node";
import * as Hyperlink from "../../src/Hyperlink";

const HTTP_PORT = 7791;
const WS_PORT = 7792;
const RPC_KEY = "mp-proof/rpc";

// One node identity, two transports — the `{ http, ws }` shorthand.
class Fleet extends Node.Service<Fleet>()("mp-proof/fleet", {
  http: `http://127.0.0.1:${HTTP_PORT}/rpc`,
  ws: `ws://127.0.0.1:${WS_PORT}/rpc`,
}) {}

// Bound to Fleet — its presence makes each server run the P3 check against Fleet's declared set.
class Bound extends Hyperlink.Service<Bound>()(
  "mp-proof/bound",
  { ping: Hyperlink.effect(Schema.Number) },
  { node: Fleet },
) {}

// The wire contract a remote dials with an explicit transport (nodeless — no auto-select).
class Wire extends Hyperlink.Service<Wire>()(RPC_KEY, { ping: Hyperlink.effect(Schema.Number) }) {}

const noop = { ping: Effect.succeed(0) };

const program = Effect.gen(function* () {
  const httpHits = yield* Ref.make(0);
  const wsHits = yield* Ref.make(0);
  // Transport-tagged replies: http → 100+n, ws → 200+n. Wrong routing is visible in the number.
  const httpWire = { ping: Ref.updateAndGet(httpHits, (n) => n + 1).pipe(Effect.map((n) => 100 + n)) };
  const wsWire = { ping: Ref.updateAndGet(wsHits, (n) => n + 1).pipe(Effect.map((n) => 200 + n)) };

  // Both servers bind the SAME Fleet-bound `Bound` (⇒ P3 set-membership must hold for their transport)
  // plus the nodeless `Wire` the clients dial.
  yield* Layer.build(
    Node.httpServer([Hyperlink.serve(Bound, noop), Hyperlink.serve(Wire, httpWire)]).pipe(
      Layer.provideMerge(NodeHttpServer.layer(() => createServer(), { port: HTTP_PORT })),
    ),
  );
  yield* Layer.build(
    Node.wsServer([Hyperlink.serve(Bound, noop), Hyperlink.serve(Wire, wsWire)]).pipe(
      Layer.provideMerge(NodeHttpServer.layer(() => createServer(), { port: WS_PORT })),
    ),
  );
  yield* Effect.logInfo(
    `both servers booted on node "mp-proof/fleet" — http :${HTTP_PORT}, ws :${WS_PORT} (P3 passed for Http AND WebSocket)`,
  );

  // Round-trip the SAME contract over each transport, supplied explicitly (as a remote runtime would).
  const callOver = (label: string, transport: Layer.Layer<RpcClient.Protocol>) =>
    Effect.gen(function* () {
      const wire = yield* Wire;
      return yield* wire.ping;
    }).pipe(
      Effect.provide(Hyperlink.client(Wire).pipe(Layer.provide(Hyperlink.layerProtocol(transport)))),
      Effect.scoped,
      Effect.tap((n) => Effect.logInfo(`  ${label} → ping returned ${n}`)),
    );

  const overHttp = yield* callOver("over http", Hyperlink.protocolHttp(`http://127.0.0.1:${HTTP_PORT}/rpc`));
  const overWs = yield* callOver("over ws  ", Hyperlink.protocolWebsocket(`ws://127.0.0.1:${WS_PORT}/rpc`));

  const httpN = yield* Ref.get(httpHits);
  const wsN = yield* Ref.get(wsHits);
  const pass = overHttp === 101 && overWs === 201 && httpN === 1 && wsN === 1;
  yield* Effect.logInfo(
    pass
      ? `PASS — one node "mp-proof/fleet", both transports live and correctly routed: http server saw ${httpN} (ret ${overHttp}), ws server saw ${wsN} (ret ${overWs})`
      : `FAIL — overHttp=${overHttp} overWs=${overWs} httpHits=${httpN} wsHits=${wsN}`,
  );
  if (!pass) {
    return yield* Effect.die(
      new Error(`multi-protocol dual-serve proof failed: overHttp=${overHttp} overWs=${overWs} httpHits=${httpN} wsHits=${wsN}`),
    );
  }
}).pipe(Effect.scoped);

// ---cut-after---
NodeRuntime.runMain(program);

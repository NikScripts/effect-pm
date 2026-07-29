/**
 * @module examples/daemon/serve-client
 *
 * `Daemon.serve` exposes a daemon over RPC; `Hyperlink.client` drives the same
 * Tag from a separate client layer.
 *
 * Run: `pnpm run example:daemon-serve-client`
 *
 * Docs: `docs/examples/daemon/serve-client.md` includes this file;
 * cut markers hide the module header and runner epilogue.
 */

import { runNodeProgramOrExit } from "../shared/demo-harness";

// ---cut---
import { NodeHttpServer } from "@effect/platform-node";
import { Effect, Layer, Schema } from "effect";
import { FetchHttpClient, HttpServer } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import * as Daemon from "../../src/Daemon";
import * as Hyperlink from "../../src/Hyperlink";
import * as Node from "../../src/Node";

const Report = Schema.Struct({ count: Schema.Number });

class RemoteReport extends Daemon.Tag<RemoteReport>()(
  "examples/daemon/RemoteReport",
  { success: Report },
).pipe(Daemon.schedule([])) {}

const ServerLive = Node.httpServer([
  Daemon.serve(RemoteReport, {
    effect: Effect.succeed({ count: 1 }),
  }),
]).pipe(Layer.provideMerge(NodeHttpServer.layerTest));

const httpProtocol = (port: number) =>
  RpcClient.layerProtocolHttp({
    url: `http://127.0.0.1:${String(port)}/rpc`,
  }).pipe(
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(FetchHttpClient.layer),
  );

const program = Effect.gen(function* () {
  const address = yield* HttpServer.HttpServer.pipe(
    Effect.map((server) => server.address),
  );
  const port = address._tag === "TcpAddress" ? address.port : 0;

  yield* Effect.gen(function* () {
    const daemon = yield* RemoteReport;
    const result = yield* daemon.run;
    yield* Effect.logInfo(`remote daemon result count=${String(result.count)}`);
  }).pipe(
    Effect.provide(
      Hyperlink.client(RemoteReport).pipe(Layer.provide(httpProtocol(port))),
    ),
    Effect.scoped,
  );
}).pipe(Effect.provide(ServerLive), Effect.scoped);
const main = program.pipe(Effect.orDie);
// ---cut-after---

runNodeProgramOrExit(main, "example:daemon-serve-client finished OK");

/**
 * @module examples/readiness/degraded-health
 *
 * A not-ready HyperService flips the node's HTTP health route to 503 with a
 * `status: "degraded"` body and per-service readiness rows.
 *
 * Run: `pnpm run example:readiness-degraded-health`
 *
 * Docs: `docs/examples/readiness/degraded-health.md` includes this file;
 * cut markers hide the module header and runner epilogue.
 */

import { runNodeProgramOrExit } from "../shared/demo-harness";

// ---cut---
import { NodeHttpServer } from "@effect/platform-node";
import { Effect, Layer, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpServer } from "effect/unstable/http";
import * as Hyperlink from "../../src/Hyperlink";
import * as Node from "../../src/Node";

class WarmingCache extends Hyperlink.Tag<WarmingCache>()(
  "examples/readiness/WarmingCache",
  {
    ping: Hyperlink.effect(Schema.String),
  },
).pipe(
  Hyperlink.withReadiness(() =>
    Effect.succeed({ ready: false, detail: "warming cache" }),
  ),
) {}

const ServerLive = Node.httpServer(
  [
    Hyperlink.serve(WarmingCache, {
      ping: Effect.succeed("pong"),
    }),
  ],
  { health: { path: "/health" } },
).pipe(Layer.provideMerge(NodeHttpServer.layerTest));

const program = Effect.gen(function* () {
  const address = yield* HttpServer.HttpServer.pipe(
    Effect.map((server) => server.address),
  );
  const port = address._tag === "TcpAddress" ? address.port : 0;
  const response = yield* Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    return yield* client.get(`http://127.0.0.1:${String(port)}/health`);
  }).pipe(Effect.provide(FetchHttpClient.layer), Effect.scoped);
  const body = (yield* response.json) as {
    readonly status: string;
    readonly services: ReadonlyArray<{
      readonly key: string;
      readonly ready: boolean;
      readonly detail?: string;
    }>;
  };
  const row = body.services[0];
  yield* Effect.logInfo(
    `/health ${String(response.status)} ${body.status}: ${row?.key ?? "?"} ready=${String(row?.ready ?? false)} detail=${row?.detail ?? "none"}`,
  );
  if (response.status !== 503 || body.status !== "degraded") {
    return yield* Effect.die(
      new Error(`expected degraded 503, got ${String(response.status)} ${body.status}`),
    );
  }
}).pipe(Effect.provide(ServerLive), Effect.scoped, Effect.orDie);
// ---cut-after---

runNodeProgramOrExit(program, "example:readiness-degraded-health finished OK");

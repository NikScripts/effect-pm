import { Effect, Layer, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpServer } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import * as Resource from "../src/Resource";
import * as HostStatus from "../src/HostStatus";

// A resource carries its own readiness derivation (here a bare Resource.Tag opts in via
// `withReadiness`). When it reports "not ready", the host's `/health` returns 503 and `HostStatus`
// reads `degraded` with the per-resource detail — the same aggregate, two faces (SSOT).
class Warming extends Resource.Tag<Warming>()("readiness/Warming", {
  ping: Resource.query(Schema.String),
}).pipe(
  Resource.withReadiness(() => Effect.succeed({ ready: false, detail: "warming up" })),
) {}

const Server = Resource.serveAllHttp([
  { tag: Warming, impl: { ping: Effect.succeed("pong") } },
]).pipe(Layer.provideMerge(NodeHttpServer.layerTest));

const withPort = <A, E, R>(
  use: (port: number) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R | HttpServer.HttpServer> =>
  Effect.gen(function* () {
    const addr = yield* HttpServer.HttpServer.pipe(Effect.map((s) => s.address));
    return yield* use(addr._tag === "TcpAddress" ? addr.port : 0);
  });

it("a not-ready resource flips /health to 503 (degraded) with its detail", () =>
  Effect.runPromise(
    withPort((port) =>
      Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient;
        const res = yield* client.get(`http://127.0.0.1:${port}/health`);
        expect(res.status).toBe(503);
        const body = yield* res.text;
        expect(body).toContain('"status":"degraded"');
        expect(body).toContain('"ready":false');
        expect(body).toContain("warming up");
      }).pipe(Effect.provide(FetchHttpClient.layer), Effect.scoped),
    ).pipe(Effect.provide(Server), Effect.scoped),
  ));

it("HostStatus reports the same per-resource readiness (degraded board)", () =>
  Effect.runPromise(
    withPort((port) =>
      Effect.gen(function* () {
        const host = yield* HostStatus.Tag;
        const snap = yield* host.statusNow;
        expect(snap.status).toBe("degraded");
        expect(snap.resources.length).toBe(1);
        expect(snap.resources[0]?.ready).toBe(false);
        expect(snap.resources[0]?.detail).toBe("warming up");
        expect(snap.resources[0]?.key).toBe("readiness/Warming");
      }).pipe(
        Effect.provide(HostStatus.clientHttp(`http://127.0.0.1:${port}/rpc`)),
        Effect.scoped,
      ),
    ).pipe(Effect.provide(Server), Effect.scoped),
  ));

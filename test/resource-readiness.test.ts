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

// ── readiness composition: a resource whose readiness depends on another resource ───────────────
// The DB is a proper resource with its own readiness; a worker extends its base "running" check to
// also require the DB (via `readinessOf` + `allReady`), reusing — not redefining — both checks.
class Database extends Resource.Tag<Database>()("dep/Database", {
  ping: Resource.query(Schema.Boolean),
}).pipe(
  Resource.withReadiness((svc) =>
    Effect.map(svc.ping, (ok) => (ok ? { ready: true } : { ready: false, detail: "disconnected" })),
  ),
) {}

class Worker extends Resource.Tag<Worker>()("dep/Worker", {
  running: Resource.query(Schema.Boolean),
}).pipe(
  // a "factory" base check: ready iff running
  Resource.withReadiness((svc) =>
    Effect.map(svc.running, (r) => (r ? { ready: true } : { ready: false, detail: "stopped" })),
  ),
  // a consumer extends it: still running AND the Database dependency is ready
  Resource.withReadiness((_svc, base) =>
    Resource.allReady([base, Resource.readinessOf(Database)]),
  ),
) {}

const checkWorker = (dbOk: boolean, running: boolean) =>
  Effect.gen(function* () {
    const worker = yield* Worker;
    return yield* Resource.readinessCheck(Worker, worker);
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Resource.layer(Database, { ping: Effect.succeed(dbOk) }),
        Resource.layer(Worker, { running: Effect.succeed(running) }),
      ),
    ),
  );

it("ready when the worker's own check and its DB dependency are both ready", () =>
  Effect.runPromise(checkWorker(true, true)).then((r) => expect(r).toEqual({ ready: true })));

it("not ready (with the dependency's detail) when the DB is down", () =>
  Effect.runPromise(checkWorker(false, true)).then((r) =>
    expect(r).toEqual({ ready: false, detail: "disconnected" })));

it("the factory/base check still applies — a stopped worker is not ready even if the DB is up", () =>
  Effect.runPromise(checkWorker(true, false)).then((r) =>
    expect(r).toEqual({ ready: false, detail: "stopped" })));

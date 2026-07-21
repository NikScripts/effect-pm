import { Effect, Layer, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpServer } from "effect/unstable/http";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import * as Resource from "../src/Resource";
import * as NodeStatus from "../src/NodeStatus";
import * as Node from "../src/Node";

// A resource carries its own readiness derivation (here a bare Resource.Tag opts in via
// `withReadiness`). When it reports "not ready", the node's `/health` returns 503 and `NodeStatus`
// reads `degraded` with the per-resource detail — the same aggregate, two faces (SSOT).
class Warming extends Resource.Tag<Warming>()("readiness/Warming", {
  ping: Resource.effect(Schema.String),
}).pipe(
  Resource.withReadiness(() => Effect.succeed({ ready: false, detail: "warming up" })),
) {}

const Server = Node.httpServer([
  Resource.serve(Warming, { ping: Effect.succeed("pong") }),
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

it("NodeStatus reports the same per-resource readiness (degraded board)", () =>
  Effect.runPromise(
    withPort((port) =>
      Effect.gen(function* () {
        const node = yield* NodeStatus.Tag;
        const snap = yield* node.status.get;
        expect(snap.status).toBe("degraded");
        expect(snap.resources.length).toBe(1);
        expect(snap.resources[0]?.ready).toBe(false);
        expect(snap.resources[0]?.detail).toBe("warming up");
        expect(snap.resources[0]?.key).toBe("readiness/Warming");
      }).pipe(
        Effect.provide(NodeStatus.clientHttp(`http://127.0.0.1:${port}/rpc`)),
        Effect.scoped,
      ),
    ).pipe(Effect.provide(Server), Effect.scoped),
  ));

// ── readiness composition: a resource whose readiness depends on another resource ───────────────
// The DB is a proper resource with its own readiness; a worker extends its base "running" check to
// also require the DB (via `readinessOf` + `allReady`), reusing — not redefining — both checks.
class Database extends Resource.Tag<Database>()("dep/Database", {
  ping: Resource.effect(Schema.Boolean),
}).pipe(
  Resource.withReadiness((svc) =>
    Effect.map(svc.ping, (ok) => (ok ? { ready: true } : { ready: false, detail: "disconnected" })),
  ),
) {}

class Worker extends Resource.Tag<Worker>()("dep/Worker", {
  running: Resource.effect(Schema.Boolean),
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

// Regression: a node-bound tag must be able to extend readiness via `.pipe`. Data-last duals
// constrain `T` with a shallow `PipeableTag` brand (spec symbol only) so stock tsc does not expand
// `ServiceOf<S, Self>` on the still-declaring class (TS2589). See `resource-withreadiness-pipe.test-d.ts`.
class DepNode extends Node.Tag<DepNode>()("dep/node") {}
class NodeWorker extends Resource.Tag<NodeWorker>()(
  "dep/NodeWorker",
  { running: Resource.effect(Schema.Boolean) },
  { node: DepNode },
).pipe(
  Resource.withReadiness((svc) =>
    Effect.map(svc.running, (r) => (r ? { ready: true } : { ready: false, detail: "stopped" })),
  ),
) {}

it("a node-bound tag can extend readiness via .pipe (regression)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const w = yield* NodeWorker;
      return yield* Resource.readinessCheck(NodeWorker, w);
    }).pipe(Effect.provide(Resource.layer(NodeWorker, { running: Effect.succeed(false) }))),
  ).then((r) => expect(r).toEqual({ ready: false, detail: "stopped" })));

// Regression: data-first `withReadiness(tag, fn)` accepts a fully-defined node-bound CLASS (a
// `typeof X` constructor). The data-first overloads are inferred (like `client`/`layer`), so the class
// matches and its node is preserved in the return.
class DataFirstWorker extends Resource.Tag<DataFirstWorker>()(
  "dep/DataFirstWorker",
  { running: Resource.effect(Schema.Boolean) },
  { node: DepNode },
) {}

it("data-first withReadiness accepts a node-bound class (regression)", () => {
  const tag = Resource.withReadiness(DataFirstWorker, (svc) =>
    Effect.map(svc.running, (r) => (r ? { ready: true } : { ready: false, detail: "stopped" })),
  );
  expect(tag).toBe(DataFirstWorker);
});

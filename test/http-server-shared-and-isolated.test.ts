import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Layer, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpServer } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { NodeHttpServer } from "@effect/platform-node";
import * as Resource from "../src/Resource";

/**
 * Escape hatch for "one outlier with a private dep on an otherwise shared host":
 * `Resource.provide(shared, [serve…])` for the homogeneous majority next to an
 * isolated `serve.pipe(Layer.provide(private))` — one `httpServer`, one `/rpc`.
 * (Replacement for the retired `serveAllHttp` rewrite cliff.)
 */
class SharedDep extends Context.Service<SharedDep, number>()(
  "@nikscripts/effect-pm/test/http-server-shared-and-isolated.test/SharedDep",
) {}

class PrivateDep extends Context.Service<PrivateDep, number>()(
  "@nikscripts/effect-pm/test/http-server-shared-and-isolated.test/PrivateDep",
) {}

class MajorityA extends Resource.Tag<MajorityA>()("sharedIso/A", {
  read: Resource.effect(Schema.Number),
}) {}
class MajorityB extends Resource.Tag<MajorityB>()("sharedIso/B", {
  read: Resource.effect(Schema.Number),
}) {}
class Outlier extends Resource.Tag<Outlier>()("sharedIso/Outlier", {
  read: Resource.effect(Schema.Number),
}) {}

const sharedImpl = { read: Effect.map(SharedDep, (n) => n) };
const outlierImpl = { read: Effect.map(PrivateDep, (n) => n) };

const Node = Resource.httpServer(
  [
    Resource.provide(Layer.succeed(SharedDep, 10), [
      Resource.serveRemote(MajorityA, sharedImpl),
      Resource.serveRemote(MajorityB, sharedImpl),
    ]),
    Resource.serveRemote(Outlier, outlierImpl).pipe(
      Layer.provide(Layer.succeed(PrivateDep, 99)),
    ),
  ],
  { health: { path: "/health" } },
).pipe(Layer.provideMerge(NodeHttpServer.layerTest));

const protocol = (url: string) =>
  RpcClient.layerProtocolHttp({ url }).pipe(
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(FetchHttpClient.layer),
  );

describe("httpServer — shared majority + isolated outlier", () => {
  it.effect("one /rpc: shared dep memoized; outlier keeps a private dep; /health lists all", () =>
    Effect.gen(function* () {
      const addr = yield* HttpServer.HttpServer.pipe(Effect.map((s) => s.address));
      const port = addr._tag === "TcpAddress" ? addr.port : 0;
      const base = `http://127.0.0.1:${port}`;

      yield* Effect.gen(function* () {
        const a = yield* MajorityA;
        const b = yield* MajorityB;
        const o = yield* Outlier;
        expect(yield* a.read).toBe(10);
        expect(yield* b.read).toBe(10);
        expect(yield* o.read).toBe(99);
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Resource.client(MajorityA).pipe(Layer.provide(protocol(`${base}/rpc`))),
            Resource.client(MajorityB).pipe(Layer.provide(protocol(`${base}/rpc`))),
            Resource.client(Outlier).pipe(Layer.provide(protocol(`${base}/rpc`))),
          ),
        ),
        Effect.scoped,
      );

      const health = yield* Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient;
        const response = yield* client.get(`${base}/health`);
        return yield* response.json;
      }).pipe(Effect.provide(FetchHttpClient.layer), Effect.orDie);

      const body = health as {
        readonly status: string;
        readonly resources: ReadonlyArray<{ readonly key: string }>;
      };
      expect(body.status).toBe("ok");
      expect(body.resources.map((r) => r.key).sort()).toEqual([
        "sharedIso/A",
        "sharedIso/B",
        "sharedIso/Outlier",
      ]);
    }).pipe(Effect.provide(Node), Effect.scoped),
  );
});

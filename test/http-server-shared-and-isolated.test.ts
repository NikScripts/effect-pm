import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Layer, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpServer } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { NodeHttpServer } from "@effect/platform-node";
import * as Hyperlink from "../src/Hyperlink";
import * as PmNode from "../src/Node";

/**
 * Escape hatch for "one outlier with a private dep on an otherwise shared host":
 * `Hyperlink.provide(shared, [serve…])` for the homogeneous majority next to an
 * isolated `serve.pipe(Layer.provide(private))` — one `httpServer`, one `/rpc`.
 * (Replacement for the retired `serveAllHttp` rewrite cliff.)
 */
class SharedDep extends Context.Service<SharedDep, number>()(
  "hyperlink-ts/test/http-server-shared-and-isolated.test/SharedDep",
) {}

class PrivateDep extends Context.Service<PrivateDep, number>()(
  "hyperlink-ts/test/http-server-shared-and-isolated.test/PrivateDep",
) {}

class MajorityA extends Hyperlink.Tag<MajorityA>()("sharedIso/A", {
  read: Hyperlink.effect(Schema.Number),
}) {}
class MajorityB extends Hyperlink.Tag<MajorityB>()("sharedIso/B", {
  read: Hyperlink.effect(Schema.Number),
}) {}
class Outlier extends Hyperlink.Tag<Outlier>()("sharedIso/Outlier", {
  read: Hyperlink.effect(Schema.Number),
}) {}

const sharedImpl = { read: Effect.map(SharedDep, (n) => n) };
const outlierImpl = { read: Effect.map(PrivateDep, (n) => n) };

const Node = PmNode.httpServer(
  [
    Hyperlink.provide(Layer.succeed(SharedDep, 10), [
      Hyperlink.serveRemote(MajorityA, sharedImpl),
      Hyperlink.serveRemote(MajorityB, sharedImpl),
    ]),
    Hyperlink.serveRemote(Outlier, outlierImpl).pipe(
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
            Hyperlink.client(MajorityA).pipe(Layer.provide(protocol(`${base}/rpc`))),
            Hyperlink.client(MajorityB).pipe(Layer.provide(protocol(`${base}/rpc`))),
            Hyperlink.client(Outlier).pipe(Layer.provide(protocol(`${base}/rpc`))),
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
        readonly services: ReadonlyArray<{ readonly key: string }>;
      };
      expect(body.status).toBe("ok");
      expect(body.services.map((r) => r.key).sort()).toEqual([
        "sharedIso/A",
        "sharedIso/B",
        "sharedIso/Outlier",
      ]);
    }).pipe(Effect.provide(Node), Effect.scoped),
  );
});

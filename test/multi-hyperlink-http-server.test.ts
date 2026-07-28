import { Context, Effect, Layer, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpServer } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import * as Hyperlink from "../src/Hyperlink";
import * as PmNode from "../src/Node";

// End-to-end: Hyperlink.serve + PmNode.httpServer + the served-resources registry. Two resources need
// the SAME Dep tag with DIFFERENT values (isolated per resource), served on one /rpc, with /health
// listing both (which only works if the registry was populated before httpServer read it).

class Dep extends Context.Service<Dep, number>()(
  "hyperlink-ts/test/multi-hyperlink-http-server.test/Dep",
) {}

class A extends Hyperlink.Tag<A>()("httpserver/A", { read: Hyperlink.effect(Schema.Number) }) {}
class B extends Hyperlink.Tag<B>()("httpserver/B", { read: Hyperlink.effect(Schema.Number) }) {}

const impl = { read: Effect.map(Dep, (value) => value) };

const layerA = Hyperlink.serveRemote(A, impl).pipe(Layer.provide(Layer.succeed(Dep, 1)));
const layerB = Hyperlink.serveRemote(B, impl).pipe(Layer.provide(Layer.succeed(Dep, 2)));

// the serves form — httpServer([...]) bundles the provideMerge + registry
const Node = PmNode.httpServer([layerA, layerB], { health: { path: "/health" } }).pipe(
  Layer.provideMerge(NodeHttpServer.layerTest),
);

const protocol = (url: string) =>
  RpcClient.layerProtocolHttp({ url }).pipe(
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(FetchHttpClient.layer),
  );

it("httpServer serves serve layers on one /rpc, isolated, with /health listing both", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const addr = yield* HttpServer.HttpServer.pipe(Effect.map((server) => server.address));
      const port = addr._tag === "TcpAddress" ? addr.port : 0;
      const base = `http://127.0.0.1:${port}`;

      // isolation over RPC
      yield* Effect.gen(function* () {
        const a = yield* A;
        const b = yield* B;
        expect(yield* a.read).toBe(1);
        expect(yield* b.read).toBe(2);
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Hyperlink.client(A).pipe(Layer.provide(protocol(`${base}/rpc`))),
            Hyperlink.client(B).pipe(Layer.provide(protocol(`${base}/rpc`))),
          ),
        ),
        Effect.scoped,
      );

      // /health lists BOTH resources — proves the registry was populated before httpServer read it
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
      expect(body.services.map((r) => r.key).sort()).toEqual(["httpserver/A", "httpserver/B"]);
    }).pipe(Effect.provide(Node), Effect.scoped),
  ));

import { Context, Effect, Layer, Schema } from "effect";
import { FetchHttpClient, HttpServer, HttpRouter } from "effect/unstable/http";
import { RpcClient, RpcSerialization, RpcServer } from "effect/unstable/rpc";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import * as Resource from "../src/Resource";

// PROTOTYPE — the beta.18 crux: can N group.toLayer handler layers, each with its OWN dependency
// Layer.provided, feed ONE RpcServer without collapsing? Same dependency TAG, two different values.

class Dep extends Context.Service<Dep, number>()("proto/Dep") {}

class A extends Resource.Tag<A>()("proto/A", { read: Resource.query(Schema.Number) }) {}
class B extends Resource.Tag<B>()("proto/B", { read: Resource.query(Schema.Number) }) {}

// each handler reads the SAME Dep tag — provided per-resource with a different value below
const readDep = Effect.gen(function* () {
  return yield* Dep;
});
const impl = { read: readDep };

// each resource's handler layer, its own Dep value provided — ISOLATED via Layer.provide
const layerA = Resource.serverR<Dep>(A, impl).pipe(Layer.provide(Layer.succeed(Dep, 1)));
const layerB = Resource.serverR<Dep>(B, impl).pipe(Layer.provide(Layer.succeed(Dep, 2)));

const merged = (Resource.groupOf(A) as any).merge(Resource.groupOf(B));

const Server = HttpRouter.serve(
  RpcServer.layerHttp({ group: merged, path: "/rpc", protocol: "http" }).pipe(
    Layer.provide(Layer.mergeAll(layerA, layerB) as any), // ← the crux: two toLayers, one server
  ),
).pipe(
  Layer.provideMerge(RpcSerialization.layerNdjson),
  Layer.provideMerge(NodeHttpServer.layerTest),
);

const protocol = (url: string) =>
  RpcClient.layerProtocolHttp({ url }).pipe(
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(FetchHttpClient.layer),
  );

it("N handler layers, each with its own dependency, feed one RpcServer — isolated", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const addr = yield* HttpServer.HttpServer.pipe(Effect.map((s) => s.address));
      const port = addr._tag === "TcpAddress" ? addr.port : 0;
      const p = protocol(`http://127.0.0.1:${port}/rpc`);
      yield* Effect.gen(function* () {
        const a = yield* A;
        const b = yield* B;
        expect(yield* a.read).toBe(1); // A's handler saw Dep = 1
        expect(yield* b.read).toBe(2); // B's handler saw Dep = 2 → NOT collapsed
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Resource.client(A).pipe(Layer.provide(p)),
            Resource.client(B).pipe(Layer.provide(p)),
          ),
        ),
        Effect.scoped,
      );
    }).pipe(Effect.provide(Server), Effect.scoped),
  ));

import { Context, Effect, Layer, Schema } from "effect";
import { FetchHttpClient, HttpServer, HttpRouter } from "effect/unstable/http";
import { RpcClient, RpcSerialization, RpcServer } from "effect/unstable/rpc";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import * as Resource from "../src/Resource";

// The beta.18 mechanism: N resources needing different implementations of the SAME dependency tag, each
// isolated. `Resource.serve` preserves the handler's requirement `R`, so a per-resource `Layer.provide`
// discharges it — and the layers still merge onto one shared RpcServer.

class Dep extends Context.Service<Dep, number>()(
  "@nikscripts/effect-pm/test/multi-resource-isolated-deps.test/Dep",
) {}

class A extends Resource.Tag<A>()("proto/A", { read: Resource.query(Schema.Number) }) {}
class B extends Resource.Tag<B>()("proto/B", { read: Resource.query(Schema.Number) }) {}

// one impl reading the Dep tag — its requirement `R = Dep` is inferred + preserved by `serve`
const impl = { read: Effect.map(Dep, (value) => value) };

// each resource's handler layer, its own Dep value provided — isolated
const layerA = Resource.serve(A, impl).pipe(Layer.provide(Layer.succeed(Dep, 1)));
const layerB = Resource.serve(B, impl).pipe(Layer.provide(Layer.succeed(Dep, 2)));

const merged = Resource.groupOf(A).merge(Resource.groupOf(B));

const Server = HttpRouter.serve(
  RpcServer.layerHttp({ group: merged, path: "/rpc", protocol: "http" }).pipe(
    Layer.provide(Layer.mergeAll(layerA, layerB)), // two serve layers → one RpcServer
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

it("serve preserves R so per-resource deps are isolated on one shared RpcServer", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const addr = yield* HttpServer.HttpServer.pipe(Effect.map((server) => server.address));
      const port = addr._tag === "TcpAddress" ? addr.port : 0;
      const clientTransport = protocol(`http://127.0.0.1:${port}/rpc`);
      yield* Effect.gen(function* () {
        const a = yield* A;
        const b = yield* B;
        expect(yield* a.read).toBe(1); // A's handler saw Dep = 1
        expect(yield* b.read).toBe(2); // B's handler saw Dep = 2 → isolated, not collapsed
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Resource.client(A).pipe(Layer.provide(clientTransport)),
            Resource.client(B).pipe(Layer.provide(clientTransport)),
          ),
        ),
        Effect.scoped,
      );
    }).pipe(Effect.provide(Server), Effect.scoped),
  ));

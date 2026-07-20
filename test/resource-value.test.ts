import { Effect, Layer, Schema, SubscriptionRef } from "effect";
import { FetchHttpClient, HttpServer } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import * as Resource from "../src/Resource";
import * as PmNode from "../src/Node";

// `ref` fields surface as a `Subscribable`: `yield* p.x.get` (current value) + `p.x.changes` (stream),
// uniform local and remote. The impl owns the `SubscriptionRef` (provided via `Resource.subscribable`).

class Live extends Resource.Tag<Live>()("ref-test/Live", {
  count: Resource.ref(Schema.Number),
}) {}

const protocol = (url: string) =>
  RpcClient.layerProtocolHttp({ url }).pipe(
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(FetchHttpClient.layer),
  );

it("ref.get reads the current value — LOCAL (no mirror, no sleep)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cell = yield* SubscriptionRef.make(0);
      yield* Effect.gen(function* () {
        const p = yield* Live;
        expect(yield* p.count.get).toBe(0);
        yield* SubscriptionRef.set(cell, 5);
        expect(yield* p.count.get).toBe(5); // get reads the source directly — always current
      }).pipe(
        Effect.provide(Resource.layer(Live, { count: Resource.subscribable(cell) })),
        Effect.scoped,
      );
    }),
  ));

it("ref.get reads the current value — REMOTE (same shape over the wire)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cell = yield* SubscriptionRef.make(42);
      const Node = PmNode.httpServer([
        Resource.serve(Live, { count: Resource.subscribable(cell) }),
      ]).pipe(Layer.provideMerge(NodeHttpServer.layerTest));

      yield* Effect.gen(function* () {
        const addr = yield* HttpServer.HttpServer.pipe(Effect.map((s) => s.address));
        const port = addr._tag === "TcpAddress" ? addr.port : 0;
        const base = `http://127.0.0.1:${port}`;

        yield* Effect.gen(function* () {
          const p = yield* Live;
          expect(yield* p.count.get).toBe(42); // current, reconstructed from the RPC changes stream
        }).pipe(
          Effect.provide(Resource.client(Live).pipe(Layer.provide(protocol(`${base}/rpc`)))),
          Effect.scoped,
        );
      }).pipe(Effect.provide(Node), Effect.scoped);
    }),
  ));

import { Duration, Effect, Layer, Schema, SubscriptionRef } from "effect";
import { FetchHttpClient, HttpServer } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import * as Resource from "../src/Resource";

// `value` fields are PLAIN properties kept live by a background stream. Read with no yield*; the property
// tracks the source; acquire blocks for the initial value.

class Live extends Resource.Tag<Live>()("value-test/Live", {
  count: Resource.value(Schema.Number),
}) {}

const protocol = (url: string) =>
  RpcClient.layerProtocolHttp({ url }).pipe(
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(FetchHttpClient.layer),
  );

it("value is plain + live — LOCAL", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ref = yield* SubscriptionRef.make(0);
      yield* Effect.gen(function* () {
        const p = yield* Live;
        expect(p.count).toBe(0); // initial, plain — no yield*
        yield* SubscriptionRef.set(ref, 5);
        yield* Effect.sleep(Duration.millis(30)); // let the updater fiber apply the delta
        const p2 = yield* Live;
        expect(p2.count).toBe(5); // live — the property tracked the source
      }).pipe(
        Effect.provide(Resource.layer(Live, { count: SubscriptionRef.changes(ref) })),
        Effect.scoped,
      );
    }),
  ));

it("value is plain + resolved at acquire — REMOTE (same shape)", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ref = yield* SubscriptionRef.make(42);
      const Node = Resource.serveAllHttp([
        Resource.serverEntry(Live, { count: SubscriptionRef.changes(ref) }),
      ]).pipe(Layer.provideMerge(NodeHttpServer.layerTest));

      yield* Effect.gen(function* () {
        const addr = yield* HttpServer.HttpServer.pipe(Effect.map((s) => s.address));
        const port = addr._tag === "TcpAddress" ? addr.port : 0;
        const base = `http://127.0.0.1:${port}`;

        yield* Effect.gen(function* () {
          const p = yield* Live;
          expect(p.count).toBe(42); // plain — the initial delta, over the wire
        }).pipe(
          Effect.provide(Resource.client(Live).pipe(Layer.provide(protocol(`${base}/rpc`)))),
          Effect.scoped,
        );
      }).pipe(Effect.provide(Node), Effect.scoped);
    }),
  ));

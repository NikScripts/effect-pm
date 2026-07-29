/**
 * @module examples/hyperlink/serve-client
 *
 * Serve the same Counter Tag over RPC and consume it from a client layer. The client
 * code still resolves `yield* Counter`; only the provided layer changes.
 *
 * ```bash
 * pnpm run example:hyperlink-serve-client
 * ```
 */

// ---cut---
import { NodeHttpServer } from "@effect/platform-node";
import { Effect, Layer, Schema, SubscriptionRef } from "effect";
import { FetchHttpClient, HttpRouter, HttpServer } from "effect/unstable/http";
import { RpcClient, RpcSerialization, RpcServer } from "effect/unstable/rpc";
import * as Hyperlink from "../../src/Hyperlink";

class Counter extends Hyperlink.Tag<Counter>()("examples/CounterRpc/Counter", {
  value: Hyperlink.ref(Schema.Number),
  current: Hyperlink.effect(Schema.Number),
  increment: Hyperlink.effectFn({ by: Schema.Number }, Schema.Number),
  reset: Hyperlink.effect(Schema.Void),
}) {}

const counterImpl = Effect.gen(function* () {
  const value = yield* SubscriptionRef.make(40);
  return {
    value: Hyperlink.subscribable(value),
    current: SubscriptionRef.get(value),
    increment: ({ by }: { readonly by: number }) =>
      SubscriptionRef.update(value, (n) => n + by).pipe(
        Effect.andThen(SubscriptionRef.get(value)),
      ),
    reset: SubscriptionRef.set(value, 0),
  };
});

const ServerLive = HttpRouter.serve(
  RpcServer.layerHttp({
    group: Hyperlink.groupOf(Counter),
    path: "/rpc",
    protocol: "http",
  }).pipe(Layer.provide(Hyperlink.serve(Counter, counterImpl))),
).pipe(
  Layer.provideMerge(RpcSerialization.layerNdjson),
  Layer.provideMerge(NodeHttpServer.layerTest),
);

const program = Effect.gen(function* () {
  const address = yield* HttpServer.HttpServer.pipe(
    Effect.map((server) => server.address),
  );
  const port = address._tag === "TcpAddress" ? address.port : 0;
  const transport = RpcClient.layerProtocolHttp({
    url: `http://127.0.0.1:${String(port)}/rpc`,
  }).pipe(
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(FetchHttpClient.layer),
  );

  const result = yield* Effect.gen(function* () {
    const counter = yield* Counter;
    const current = yield* counter.current;
    const next = yield* counter.increment({ by: 2 });
    return { current, next };
  }).pipe(
    Effect.provide(Hyperlink.client(Counter).pipe(Layer.provide(transport))),
    Effect.scoped,
  );

  yield* Effect.logInfo(
    `rpc counter current=${String(result.current)} next=${String(result.next)}`,
  );

  if (result.current !== 40 || result.next !== 42) {
    return yield* Effect.die(
      new Error(
        `unexpected current=${String(result.current)} next=${String(result.next)}`,
      ),
    );
  }
}).pipe(Effect.provide(ServerLive), Effect.scoped);

// ---cut-after---
await Effect.runPromise(
  program.pipe(Effect.tap(() => Effect.logInfo("example:hyperlink-serve-client finished OK"))),
);

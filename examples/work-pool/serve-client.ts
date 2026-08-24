/**
 * @module examples/work-pool/serve-client
 *
 * WorkPool.serve exposes a queue over RPC; Hyperlink.client drives the same Tag from a
 * separate client layer. The client code still just `yield* ServedQueue`.
 *
 * Tip surface: `WorkPool.serve` + `Hyperlink.client`. Run: `pnpm run example:work-pool-serve-client`
 *
 * Docs: `docs/examples/work-pool/serve-client.md` includes this file via Twoslash;
 * `// ---cut---` hides this module header from the page (Twoslash still type-checks it).
 */

// ---cut---
import { NodeHttpServer } from "@effect/platform-node";
import { Duration, Effect, Layer, Schema } from "effect";
import { FetchHttpClient, HttpRouter, HttpServer } from "effect/unstable/http";
import { RpcClient, RpcSerialization, RpcServer } from "effect/unstable/rpc";
import { Hyperlink, WorkPool } from "../../src";

const ServedJob = Schema.Struct({
  id: Schema.String,
});

class ServedQueue extends WorkPool.Service<ServedQueue>()("examples/ServedQueue", {
  payload: ServedJob,
}) {}

const waitUntilCompleted = (expected: number) =>
  Effect.gen(function* () {
    const queue = yield* ServedQueue;
    while ((yield* queue.status.get).completed < expected) {
      yield* Effect.sleep(Duration.millis(10));
    }
  }).pipe(Effect.timeout(Duration.seconds(3)));

const ServerLive = HttpRouter.serve(
  RpcServer.layerHttp({
    group: Hyperlink.groupOf(ServedQueue),
    path: "/rpc",
    protocol: "http",
  }).pipe(
    Layer.provide(
      WorkPool.serve(ServedQueue, {
        concurrency: 1,
        effect: (job) => Effect.logInfo(`server processed ${job.id}`),
      }),
    ),
  ),
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

  yield* Effect.gen(function* () {
    const queue = yield* ServedQueue;
    yield* queue.add([{ id: "remote-a" }, { id: "remote-b" }]);
    yield* waitUntilCompleted(2);

    const status = yield* queue.status.get;
    const pending = yield* queue.size.get;
    yield* Effect.logInfo(
      `client observed completed=${String(status.completed)} pending=${String(pending)}`,
    );
  }).pipe(
    Effect.provide(Hyperlink.client(ServedQueue).pipe(Layer.provide(transport))),
    Effect.scoped,
  );
}).pipe(Effect.provide(ServerLive), Effect.scoped);

void Effect.runPromise(
  program.pipe(
    Effect.tap(() => Effect.logInfo("example:work-pool-serve-client finished OK")),
  ),
);

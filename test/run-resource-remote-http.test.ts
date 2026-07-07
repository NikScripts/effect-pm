import { Duration, Effect, Layer, Option, Schema, Stream } from "effect";
import { FetchHttpClient, HttpServer } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import * as Resource from "../src/Resource";
import * as RunResource from "../src/RunResource";
import * as Store from "../src/Store";

class RemoteGate extends RunResource.Tag<RemoteGate>()(
  "run-remote/G",
  Schema.Number,
  Schema.Number,
  Schema.String,
) {}

const clientHttp = (port: number) =>
  RpcClient.layerProtocolHttp({ url: `http://127.0.0.1:${port}/rpc` }).pipe(
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(FetchHttpClient.layer),
  );

const withServer = <A, E>(
  use: (port: number) => Effect.Effect<A, E, RemoteGate>,
): Effect.Effect<A, E, never> => {
  const server = Resource.httpServer([
    RunResource.serve(RemoteGate, {
      effect: (n: number) =>
        n >= 0 ? Effect.succeed(n * 2) : Effect.fail("negative"),
      concurrency: 2,
    }) as Layer.Layer<any, never, any>,
  ]).pipe(
    Layer.provideMerge(NodeHttpServer.layerTest),
    Layer.provideMerge(Store.layerDefaultMemory),
  );

  return Effect.gen(function* () {
    const address = yield* HttpServer.HttpServer.pipe(
      Effect.map((s) => s.address),
    );
    const port = address._tag === "TcpAddress" ? address.port : 0;
    return yield* use(port).pipe(
      Effect.provide(
        Resource.client(RemoteGate).pipe(Layer.provide(clientHttp(port))),
      ),
      Effect.scoped,
    );
  }).pipe(Effect.provide(server), Effect.scoped) as Effect.Effect<A, E, never>;
};

it("run + status round-trip over http against the real driver", () =>
  Effect.runPromise(
    withServer((_port) =>
      Effect.gen(function* () {
        const gate = yield* RemoteGate;
        const awaitCompleted = (want: number) =>
          Stream.runHead(Stream.filter(gate.completed.changes, (n) => n === want)).pipe(
            Effect.flatMap(
              Option.match({ onNone: () => Effect.never, onSome: Effect.succeed }),
            ),
            Effect.timeout(Duration.seconds(2)),
          );

        const result = yield* gate.run(5);
        expect(result).toBe(10);
        expect(yield* awaitCompleted(1)).toBe(1);

        const status = yield* Stream.runHead(gate.status.changes).pipe(
          Effect.flatMap(
            Option.match({ onNone: () => Effect.never, onSome: Effect.succeed }),
          ),
        );
        expect(status?.completed).toBe(1);
        expect(status?.inFlight).toBe(0);
      }),
    ),
  ));

it("run failure crosses the wire with the declared error schema", () =>
  Effect.runPromise(
    withServer((_port) =>
      Effect.gen(function* () {
        const gate = yield* RemoteGate;
        const exit = yield* Effect.exit(gate.run(-1));
        expect(exit._tag).toBe("Failure");
      }),
    ),
  ));

it("static run accessor works over the remote client layer", () =>
  Effect.runPromise(
    withServer((_port) =>
      Effect.gen(function* () {
        const result = yield* RemoteGate.run(3);
        expect(result).toBe(6);
      }),
    ),
  ));

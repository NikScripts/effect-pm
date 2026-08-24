import { Duration, Effect, Layer, Option, Schema, Stream } from "effect";
import { FetchHttpClient, HttpServer } from "effect/unstable/http";
import { ServeError } from "effect/unstable/http/HttpServerError";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import * as Hyperlink from "../src/Hyperlink";
import * as Gate from "../src/Gate";
import * as Lifecycle from "../src/Lifecycle";
import * as Node from "../src/Node";

class RemoteGate extends Gate.Service<RemoteGate>()("run-remote/G", {
  payload: Schema.Number,
  success: Schema.Number,
  error: Schema.String,
}) {}

const httpProtocol = (port: number) =>
  RpcClient.layerProtocolHttp({ url: `http://127.0.0.1:${port}/rpc` }).pipe(
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(FetchHttpClient.layer),
  );

const awaitTag = <A extends { readonly _tag: string }>(
  changes: Stream.Stream<A>,
  tag: A["_tag"],
) =>
  Stream.runHead(Stream.filter(changes, (s) => s._tag === tag)).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.never,
        onSome: Effect.succeed,
      }),
    ),
    Effect.timeout(Duration.seconds(2)),
  );

const withServer = <A, E>(
  use: (port: number) => Effect.Effect<A, E, RemoteGate>,
  options?: { readonly deferStart?: boolean },
): Effect.Effect<A, E | ServeError, never> => {
  const serve =
    options?.deferStart === true
      ? Gate.serveMemory(RemoteGate, {
          effect: (n: number) =>
            n >= 0 ? Effect.succeed(n * 2) : Effect.fail("negative"),
          concurrency: 2,
        }).pipe(Hyperlink.deferStart)
      : Gate.serveMemory(RemoteGate, {
          effect: (n: number) =>
            n >= 0 ? Effect.succeed(n * 2) : Effect.fail("negative"),
          concurrency: 2,
        });
  const server = Node.httpServer([serve]).pipe(
    Layer.provideMerge(NodeHttpServer.layerTest),
  );

  return Effect.gen(function* () {
    const address = yield* HttpServer.HttpServer.pipe(
      Effect.map((s) => s.address),
    );
    const port = address._tag === "TcpAddress" ? address.port : 0;
    return yield* use(port).pipe(
      Effect.provide(
        Hyperlink.client(RemoteGate).pipe(Layer.provide(httpProtocol(port))),
      ),
      Effect.scoped,
    );
  }).pipe(Effect.provide(server), Effect.scoped);
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

it("Lifecycle duals over http — pause / resume / stop(Tag)", () =>
  Effect.runPromise(
    withServer(
      (_port) =>
        Effect.gen(function* () {
          const gate = yield* RemoteGate;
          expect((yield* awaitTag(gate.lifecycle.changes, "Idle"))._tag).toBe(
            "Idle",
          );

          yield* Lifecycle.start(RemoteGate);
          expect(
            (yield* awaitTag(gate.lifecycle.changes, "Running"))._tag,
          ).toBe("Running");

          yield* Lifecycle.pause(gate);
          expect((yield* awaitTag(gate.lifecycle.changes, "Paused"))._tag).toBe(
            "Paused",
          );

          yield* Lifecycle.resume(RemoteGate);
          expect(
            (yield* awaitTag(gate.lifecycle.changes, "Running"))._tag,
          ).toBe("Running");

          yield* Lifecycle.stop(RemoteGate);
          expect((yield* awaitTag(gate.lifecycle.changes, "Off"))._tag).toBe(
            "Off",
          );
        }),
      { deferStart: true },
    ),
  ));

it("GateStopped crosses the wire after remote stop", () =>
  Effect.runPromise(
    withServer((_port) =>
      Effect.gen(function* () {
        const gate = yield* RemoteGate;
        yield* Lifecycle.stop(gate);
        expect((yield* awaitTag(gate.lifecycle.changes, "Off"))._tag).toBe(
          "Off",
        );

        const result = yield* gate.run(1).pipe(
          Effect.catchTag("GateStopped", (err) => {
            expect(err).toBeInstanceOf(Gate.GateStopped);
            return Effect.succeed(-1);
          }),
        );
        expect(result).toBe(-1);
      }),
    ),
  ));

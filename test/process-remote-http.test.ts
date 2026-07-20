import { DateTime, Duration, Effect, Layer, Option, Stream } from "effect";
import { FetchHttpClient, HttpServer } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import * as Process from "../src/Process";
import * as Resource from "../src/Resource";
import * as Node from "../src/Node";
// The full remote path: a REAL toolkit Process driver served over http via
// `httpServer([Process.serveMemory(...)])`, driven by `Resource.client` over the wire — the same
// `yield* Tag` surface a local consumer uses, only the layer differs. Proves the control plane
// (start/stop), observation (`status`), the out-of-band run (run), and the schedule
// CRUD all cross real RPC. An empty inline schedule keeps the process disarmed (so `armed` is
// observably false) and grants the `schedule` verb group.
class RemoteProc extends Process.Tag<RemoteProc>()("proc-remote/P").pipe(
  Process.schedule([]),
) {}

// client transport: http + ndjson (matches the server's default serialization).
const clientHttp = (port: number) =>
  RpcClient.layerProtocolHttp({ url: `http://127.0.0.1:${port}/rpc` }).pipe(
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(FetchHttpClient.layer),
  );

const withServer = <A, E>(
  config: Process.ProcessLayerConfig<void, never, never>,
  use: (port: number) => Effect.Effect<A, E, RemoteProc>,
) => {
  const server = Node.httpServer([
    Process.serveMemory(RemoteProc, config),
  ]).pipe(
    Layer.provideMerge(NodeHttpServer.layerTest),
  );
  return Effect.gen(function* () {
    const address = yield* HttpServer.HttpServer.pipe(
      Effect.map((s) => s.address),
    );
    const port = address._tag === "TcpAddress" ? address.port : 0;
    return yield* use(port).pipe(
      Effect.provide(
        Resource.client(RemoteProc).pipe(Layer.provide(clientHttp(port))),
      ),
      Effect.scoped,
    );
  }).pipe(Effect.provide(server), Effect.scoped);
};

it("status + start/stop round-trip over http against the real driver", () =>
  Effect.runPromise(
    withServer({ effect: Effect.void }, (_port) =>
      Effect.gen(function* () {
        const proc = yield* RemoteProc;
        // `status` is a ref: over RPC `.get` reads a client cache fed by `.changes`, so control-plane
        // effects (start/stop) are observed by waiting on the `changes` stream (current snapshot first).
        const awaitSupervising = (want: boolean) =>
          Stream.runHead(
            Stream.filter(proc.status.changes, (s) => s.supervising === want),
          ).pipe(Effect.flatMap(Option.match({ onNone: () => Effect.never, onSome: Effect.succeed })), Effect.timeout(Duration.seconds(2)));

        const initial = yield* awaitSupervising(true); // auto-started on the server
        expect(initial.supervising).toBe(true);
        expect(initial.armed).toBe(false);

        yield* proc.stop;
        expect((yield* awaitSupervising(false)).supervising).toBe(false);

        yield* proc.start;
        expect((yield* awaitSupervising(true)).supervising).toBe(true);
      }),
    )));

it("schedule set/add/clear + read round-trip over http (entries cross the wire)", () =>
  Effect.runPromise(
    withServer({ effect: Effect.void }, (_port) =>
      Effect.gen(function* () {
        const proc = yield* RemoteProc;
        const future = DateTime.makeUnsafe(4_102_444_800_000); // 2100-01-01
        // `entries` is a ref: over RPC, mutations land on the server and propagate back through the
        // `changes` stream, so observe the resulting entry set there rather than an immediate `.get`.
        const awaitEntries = (pred: (es: ReadonlyArray<{ readonly id?: string }>) => boolean) =>
          Stream.runHead(Stream.filter(proc.schedule.entries.changes, pred)).pipe(
            Effect.flatMap(Option.match({ onNone: () => Effect.never, onSome: Effect.succeed })),
            Effect.timeout(Duration.seconds(2)),
          );

        yield* proc.schedule.set([{ id: "a", startAt: future }]);
        yield* proc.schedule.add({ id: "b", startAt: future });
        const both = yield* awaitEntries((es) => es.length === 2);
        expect(both.map((e) => e.id).sort()).toEqual(["a", "b"]);

        yield* proc.schedule.clear;
        expect(yield* awaitEntries((es) => es.length === 0)).toEqual([]);
      }),
    )));

it("the status stream flows over http from the real driver", () =>
  Effect.runPromise(
    withServer({ effect: Effect.void }, (_port) =>
      Effect.gen(function* () {
        const proc = yield* RemoteProc;
        const collected = yield* Stream.runCollect(Stream.take(proc.status.changes, 1));
        const snap = Array.from(collected)[0];
        expect(snap?.supervising).toBe(true);
      }),
    )));

it("effect crosses the wire and runs the server-side worker once", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      // a server-side side effect we can observe after the run
      let ran = 0;
      yield* withServer({ effect: Effect.sync(() => { ran += 1; }) }, (_port) =>
        Effect.gen(function* () {
          const proc = yield* RemoteProc;
          yield* proc.run;
        }));
      expect(ran).toBe(1);
    }),
  ));

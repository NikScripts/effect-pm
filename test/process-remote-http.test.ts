import { DateTime, Effect, Layer, Stream } from "effect";
import { FetchHttpClient, HttpServer } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import { ScheduledProcess } from "../src";
import type { ProcessLayerConfig } from "../src/ScheduledProcess";
import { ProcessSchedule } from "../src/ProcessSchedule";
import { Resource } from "../src/Resource";

// The full remote path: a REAL toolkit Process driver served over http via
// `ScheduledProcess.serveHttp`, driven by `Resource.client` over the wire — the same
// `yield* Tag` surface a local consumer uses, only the layer differs. Proves the control plane
// (start/stop), observation (statusNow), the out-of-band run (runImmediately), and the schedule
// CRUD all cross real RPC.
class RemoteProc extends ScheduledProcess.Tag<RemoteProc>()("proc-remote/P") {}

// client transport: http + ndjson (matches the server's default serialization).
const clientHttp = (port: number) =>
  RpcClient.layerProtocolHttp({ url: `http://127.0.0.1:${port}/rpc` }).pipe(
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(FetchHttpClient.layer),
  );

const withServer = <A, E>(
  config: ProcessLayerConfig<never, never>,
  use: (port: number) => Effect.Effect<A, E, RemoteProc>,
) => {
  const server = ScheduledProcess.serveHttp(RemoteProc, config).pipe(
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

it("statusNow + start/stop round-trip over http against the real driver", () =>
  Effect.runPromise(
    withServer({ effect: Effect.void, schedule: ProcessSchedule.empty }, (_port) =>
      Effect.gen(function* () {
        const proc = yield* RemoteProc;
        const initial = yield* proc.statusNow; // auto-started on the server
        expect(initial.supervising).toBe(true);
        expect(initial.armed).toBe(false);

        yield* proc.stop;
        expect((yield* proc.statusNow).supervising).toBe(false);

        yield* proc.start;
        expect((yield* proc.statusNow).supervising).toBe(true);
      }),
    )));

it("schedule set/add/clear + read round-trip over http (entries cross the wire)", () =>
  Effect.runPromise(
    withServer({ effect: Effect.void, schedule: ProcessSchedule.empty }, (_port) =>
      Effect.gen(function* () {
        const proc = yield* RemoteProc;
        const future = DateTime.makeUnsafe(4_102_444_800_000); // 2100-01-01

        yield* proc.setSchedule([{ id: "a", startAt: future }]);
        yield* proc.addSchedule({ id: "b", startAt: future });
        const entries = yield* proc.schedule;
        expect(entries.map((e) => e.id).sort()).toEqual(["a", "b"]);

        yield* proc.clearSchedule;
        expect(yield* proc.schedule).toEqual([]);
      }),
    )));

it("the status stream flows over http from the real driver", () =>
  Effect.runPromise(
    withServer({ effect: Effect.void }, (_port) =>
      Effect.gen(function* () {
        const proc = yield* RemoteProc;
        const collected = yield* Stream.runCollect(Stream.take(proc.status, 1));
        const snap = Array.from(collected)[0];
        expect(snap?.supervising).toBe(true);
      }),
    )));

it("runImmediately crosses the wire and runs the server-side effect once", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      // a server-side side effect we can observe after the run
      let ran = 0;
      yield* withServer({ effect: Effect.sync(() => { ran += 1; }), schedule: ProcessSchedule.empty }, (_port) =>
        Effect.gen(function* () {
          const proc = yield* RemoteProc;
          yield* proc.runImmediately;
        }));
      expect(ran).toBe(1);
    }),
  ));

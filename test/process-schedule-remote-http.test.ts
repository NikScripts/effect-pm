import { DateTime, Effect, Fiber, Layer, Stream } from "effect";
import { FetchHttpClient, HttpServer } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import { ProcessScheduleResource } from "../src";
import type { ProcessScheduleLayerConfig } from "../src/ProcessScheduleContract";
import * as Resource from "../src/Resource";

// The full remote path: a REAL ProcessSchedule store served over http, driven by `Resource.client`
// over the wire — the full CRUD + reconcile + the changes stream, all crossing real RPC.
class RemoteSchedule extends ProcessScheduleResource.Tag<RemoteSchedule>()(
  "schedule-remote/S",
) {}

const clientHttp = (port: number) =>
  RpcClient.layerProtocolHttp({ url: `http://127.0.0.1:${port}/rpc` }).pipe(
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(FetchHttpClient.layer),
  );

const withServer = <A, E>(
  config: ProcessScheduleLayerConfig | undefined,
  use: (port: number) => Effect.Effect<A, E, RemoteSchedule>,
) => {
  const server = ProcessScheduleResource.serveHttp(RemoteSchedule, config).pipe(
    Layer.provideMerge(NodeHttpServer.layerTest),
  );
  return Effect.gen(function* () {
    const address = yield* HttpServer.HttpServer.pipe(
      Effect.map((s) => s.address),
    );
    const port = address._tag === "TcpAddress" ? address.port : 0;
    return yield* use(port).pipe(
      Effect.provide(
        Resource.client(RemoteSchedule).pipe(Layer.provide(clientHttp(port))),
      ),
      Effect.scoped,
    );
  }).pipe(Effect.provide(server), Effect.scoped);
};

const future = DateTime.makeUnsafe(4_102_444_800_000); // 2100-01-01

it("CRUD round-trips over http (set/add/get/has/remove/removeMany/clear)", () =>
  Effect.runPromise(
    withServer(undefined, (_port) =>
      Effect.gen(function* () {
        const sched = yield* RemoteSchedule;

        yield* sched.set([{ id: "a", startAt: future }]);
        yield* sched.add({ id: "b", startAt: future });
        expect((yield* sched.entries).map((e) => e.id).sort()).toEqual(["a", "b"]);

        expect(yield* sched.has({ id: "a" })).toBe(true);
        expect((yield* sched.get({ id: "b" }))?.id).toBe("b");
        expect(yield* sched.get({ id: "missing" })).toBeNull();

        expect(yield* sched.remove({ id: "a" })).toBe(true);
        yield* sched.add({ id: "c", startAt: future });
        expect(yield* sched.removeMany({ ids: ["b", "c"] })).toBe(2);

        yield* sched.clear;
        expect(yield* sched.entries).toEqual([]);
      }),
    )));

it("reconcile diff-syncs over http and reports what changed", () =>
  Effect.runPromise(
    withServer({ initial: [{ id: "keep", startAt: future }, { id: "drop", startAt: future }] }, (_port) =>
      Effect.gen(function* () {
        const sched = yield* RemoteSchedule;
        const result = yield* sched.reconcile([
          { id: "keep", startAt: future }, // unchanged
          { id: "new", startAt: future }, // added
        ]);
        expect(result.added).toEqual(["new"]);
        expect(result.removed).toEqual(["drop"]);
        expect(result.unchanged).toEqual(["keep"]);
        expect((yield* sched.entries).map((e) => e.id).sort()).toEqual([
          "keep",
          "new",
        ]);
      }),
    )));

it("the changes stream flows over http (initial + after a mutation)", () =>
  Effect.runPromise(
    withServer(undefined, (_port) =>
      Effect.gen(function* () {
        const sched = yield* RemoteSchedule;
        const collected = yield* Effect.forkChild(
          Stream.runCollect(Stream.take(sched.changes, 2)),
        );
        yield* Effect.sleep("20 millis");
        yield* sched.add({ id: "x", startAt: future });
        const frames = Array.from(yield* Fiber.join(collected));
        // first frame is the (empty) initial snapshot; second reflects the mutation
        expect(frames[0]).toEqual([]);
        expect(frames[1]?.map((e) => e.id)).toEqual(["x"]);
      }),
    )));

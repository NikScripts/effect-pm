import { Duration, Effect, Layer, Option, Schema, Stream } from "effect";
import { FetchHttpClient, HttpServer } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import { Daemon, HistoryStore, Lifecycle, WorkPool } from "../src";
import type { QueueLayerConfig } from "../src/WorkPool";
import * as Hyperlink from "../src/Hyperlink";
import * as Node from "../src/Node";

/**
 * P8 proof — Participating duals over `Hyperlink.client` against a real served
 * WorkPool / Daemon. Same `Lifecycle.startFrom(Tag)` / `start(jobs)` surface as local.
 */

const NumberItem = Schema.Struct({ n: Schema.Number });
interface NumberItem {
  readonly n: number;
}

class RemoteJobs extends WorkPool.Tag<RemoteJobs>()("lifecycle-remote/Jobs", {
  payload: NumberItem,
}) {}

class RemoteSweeper extends Daemon.Tag<RemoteSweeper>()(
  "lifecycle-remote/Sweeper",
) {}

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

const withQueueServer = <A, E>(
  config: QueueLayerConfig<NumberItem, void, never, never>,
  use: Effect.Effect<A, E, RemoteJobs>,
  options?: { readonly deferStart?: boolean },
) => {
  const serve =
    options?.deferStart === true
      ? WorkPool.serveMemory(RemoteJobs, config).pipe(Hyperlink.deferStart)
      : WorkPool.serveMemory(RemoteJobs, config);
  const server = Node.httpServer([serve]).pipe(
    Layer.provide(HistoryStore.layerMemory()),
    Layer.provideMerge(NodeHttpServer.layerTest),
  );
  return Effect.gen(function* () {
    const address = yield* HttpServer.HttpServer.pipe(
      Effect.map((s) => s.address),
    );
    const port = address._tag === "TcpAddress" ? address.port : 0;
    return yield* use.pipe(
      Effect.provide(
        Hyperlink.client(RemoteJobs).pipe(Layer.provide(httpProtocol(port))),
      ),
      Effect.scoped,
    );
  }).pipe(Effect.provide(server), Effect.scoped);
};

const withDaemonServer = <A, E>(
  config: Daemon.DaemonLayerConfig<void, never, never>,
  use: Effect.Effect<A, E, RemoteSweeper>,
  options?: { readonly deferStart?: boolean },
) => {
  const serve =
    options?.deferStart === true
      ? Daemon.serveMemory(RemoteSweeper, config).pipe(Hyperlink.deferStart)
      : Daemon.serveMemory(RemoteSweeper, config);
  const server = Node.httpServer([serve]).pipe(
    Layer.provideMerge(NodeHttpServer.layerTest),
  );
  return Effect.gen(function* () {
    const address = yield* HttpServer.HttpServer.pipe(
      Effect.map((s) => s.address),
    );
    const port = address._tag === "TcpAddress" ? address.port : 0;
    return yield* use.pipe(
      Effect.provide(
        Hyperlink.client(RemoteSweeper).pipe(
          Layer.provide(httpProtocol(port)),
        ),
      ),
      Effect.scoped,
    );
  }).pipe(Effect.provide(server), Effect.scoped);
};

it("WorkPool client — startFrom / pause / resume / stop via Lifecycle duals", () =>
  Effect.runPromise(
    withQueueServer(
      { effect: () => Effect.void },
      Effect.gen(function* () {
        const jobs = yield* RemoteJobs;
        expect((yield* awaitTag(jobs.lifecycle.changes, "Idle"))._tag).toBe(
          "Idle",
        );

        yield* Lifecycle.startFrom(RemoteJobs);
        expect((yield* awaitTag(jobs.lifecycle.changes, "Running"))._tag).toBe(
          "Running",
        );

        yield* Lifecycle.pause(jobs);
        expect((yield* awaitTag(jobs.lifecycle.changes, "Paused"))._tag).toBe(
          "Paused",
        );

        yield* Lifecycle.resume(jobs);
        expect((yield* awaitTag(jobs.lifecycle.changes, "Running"))._tag).toBe(
          "Running",
        );

        yield* Lifecycle.stopFrom(RemoteJobs);
        expect((yield* awaitTag(jobs.lifecycle.changes, "Off"))._tag).toBe(
          "Off",
        );
      }),
      { deferStart: true },
    ),
  ));

it("WorkPool client — Lifecycle.start(jobs) matches startFrom(Tag)", () =>
  Effect.runPromise(
    withQueueServer(
      { effect: () => Effect.void },
      Effect.gen(function* () {
        const jobs = yield* RemoteJobs;
        expect((yield* awaitTag(jobs.lifecycle.changes, "Idle"))._tag).toBe(
          "Idle",
        );
        yield* Lifecycle.start(jobs);
        expect((yield* awaitTag(jobs.lifecycle.changes, "Running"))._tag).toBe(
          "Running",
        );
        yield* Lifecycle.startFrom(RemoteJobs); // idempotent
        expect((yield* jobs.lifecycle.get)._tag).toBe("Running");
      }),
      { deferStart: true },
    ),
  ));

it("WorkPool client — start from Off fails LifecycleIllegal", () =>
  Effect.runPromise(
    withQueueServer(
      { effect: () => Effect.void },
      Effect.gen(function* () {
        const jobs = yield* RemoteJobs;
        yield* Lifecycle.stop(jobs);
        const off = yield* awaitTag(jobs.lifecycle.changes, "Off");
        expect(off._tag).toBe("Off");

        // Dual re-checks badge via lifecycle.get (client cache); wait for Off on changes first.
        const fromTag = yield* Lifecycle.start(jobs).pipe(
          Effect.catchTag("LifecycleIllegal", (e) =>
            Effect.succeed(e.from._tag),
          ),
        );
        expect(fromTag).toBe("Off");
      }),
    ),
  ));

it("Daemon client — startFrom / stopFrom (Idle → Running → Idle)", () =>
  Effect.runPromise(
    withDaemonServer(
      { effect: Effect.void },
      Effect.gen(function* () {
        const sweeper = yield* RemoteSweeper;
        expect((yield* awaitTag(sweeper.lifecycle.changes, "Idle"))._tag).toBe(
          "Idle",
        );
        yield* Lifecycle.startFrom(RemoteSweeper);
        expect(
          (yield* awaitTag(sweeper.lifecycle.changes, "Running"))._tag,
        ).toBe("Running");
        yield* Lifecycle.stopFrom(RemoteSweeper);
        expect((yield* awaitTag(sweeper.lifecycle.changes, "Idle"))._tag).toBe(
          "Idle",
        );

        const role = yield* Lifecycle.pause(sweeper).pipe(
          Effect.catchTag("LifecycleUnsupported", (e) => Effect.succeed(e.role)),
        );
        expect(role).toBe("Pause");
      }),
      { deferStart: true },
    ),
  ));

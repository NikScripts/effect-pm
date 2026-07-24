import { Clock, Context, Duration, Effect, Exit, Layer, Schema } from "effect";
import { describe, it } from "@effect/vitest";
import { expect } from "vitest";
import * as Hyperlink from "../src/Hyperlink";
import * as Node from "../src/Node";
import * as Lookup from "../src/Lookup";
import { expectTaggedFailure } from "./fixtures/expectTaggedFailure";

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/hyperlink-ts-ws-${label}-${process.pid}-${now}.sock`;
  });

class JobsAnon extends Hyperlink.Tag<JobsAnon>()("ws/JobsAnon", {
  jobs: Hyperlink.effect(Schema.Number),
}) {}

describe("Node.ws", () => {
  it.live("node+serves — fixed localhost port + Lookup; client dials", () =>
    Effect.gen(function* () {
      const port = 20000 + (process.pid % 1000);
      const lookupPath = yield* tmpSock("bound-lookup");
      class Worker extends Node.Tag<Worker>()("ws/Worker", {
        url: `ws://127.0.0.1:${String(port)}/rpc`,
        kind: "WebSocket",
      }) {}
      class Jobs extends Hyperlink.Tag<Jobs>()("ws/Jobs", {
        jobs: Hyperlink.effect(Schema.Number),
      }).pipe(Hyperlink.andNode(Worker)) {}

      const serverCtx = yield* Layer.build(
        Node.ws(Worker, [Hyperlink.serve(Jobs, { jobs: Effect.succeed(11) })]).pipe(
          Layer.provide(
            Lookup.layerOptions({ path: lookupPath, unlink: true }),
          ),
        ),
      );
      const clientCtx = yield* Layer.build(Hyperlink.client(Jobs));

      const n = yield* Effect.gen(function* () {
        const jobs = yield* Jobs;
        return yield* jobs.jobs;
      }).pipe(Effect.provide(Context.merge(serverCtx, clientCtx)));

      expect(n).toBe(11);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
  );

  it.effect("nameless serve — WebSocket + Lookup; Hyperlink.unix(tag) dials", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("lookup");
      const serverCtx = yield* Layer.build(
        Node.ws(Hyperlink.serve(JobsAnon, { jobs: Effect.succeed(5) })).pipe(
          Layer.provide(
            Lookup.layerOptions({ path: lookupPath, unlink: true }),
          ),
        ),
      );
      const clientCtx = yield* Layer.build(
        Hyperlink.unix(JobsAnon, { lookupPath, unlink: false }),
      );
      const n = yield* Effect.gen(function* () {
        const jobs = yield* JobsAnon;
        return yield* jobs.jobs;
      }).pipe(Effect.provide(Context.merge(serverCtx, clientCtx)));
      expect(n).toBe(5);
      const listenNode = Context.get(serverCtx, Node.ListenNode);
      expect(listenNode.kind).toBe("WebSocket");
      expect(listenNode.url?.startsWith("ws://127.0.0.1:")).toBe(true);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
  );

  it.effect("nameless serve — fixed port shorthand; client dials that url", () =>
    Effect.gen(function* () {
      const port = 19200 + (process.pid % 1000);
      const lookupPath = yield* tmpSock("fixed-port");
      const serverCtx = yield* Layer.build(
        Node.ws(
          Hyperlink.serve(JobsAnon, { jobs: Effect.succeed(9) }),
          port,
        ).pipe(
          Layer.provide(
            Lookup.layerOptions({ path: lookupPath, unlink: true }),
          ),
        ),
      );
      const listenNode = Context.get(serverCtx, Node.ListenNode);
      expect(listenNode.url).toBe(`ws://127.0.0.1:${String(port)}/rpc`);
      const clientCtx = yield* Layer.build(
        Hyperlink.connect(JobsAnon, Hyperlink.protocolWebsocket(port)),
      );
      const n = yield* Effect.gen(function* () {
        const jobs = yield* JobsAnon;
        return yield* jobs.jobs;
      }).pipe(Effect.provide(Context.merge(serverCtx, clientCtx)));
      expect(n).toBe(9);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
  );

  it.effect("rejects Ipc Node with WsListenRequiresWs", () =>
    Effect.gen(function* () {
      class IpcWorker extends Node.Tag<IpcWorker>()("ws/IpcWorker", {
        path: "/tmp/hyperlink-ts-ws-reject.sock",
      }) {}
      const exit = yield* Effect.exit(
        Layer.build(
          Node.ws(IpcWorker, [
            Hyperlink.serve(JobsAnon, { jobs: Effect.succeed(1) }),
          ]),
        ).pipe(Effect.scoped),
      );
      expectTaggedFailure(exit, "WsListenRequiresWs");
      expect(Exit.isFailure(exit)).toBe(true);
    }).pipe(Effect.timeout(Duration.seconds(10))),
  );

  it.effect("listen on WebSocket Node fails with ListenUseProtocol", () =>
    Effect.gen(function* () {
      class Worker extends Node.Tag<Worker>()("ws/ListenReject", {
        url: "ws://127.0.0.1:9/rpc",
        kind: "WebSocket",
      }) {}
      const exit = yield* Effect.exit(
        Layer.build(
          Node.listen(Worker, [
            Hyperlink.serve(JobsAnon, { jobs: Effect.succeed(1) }),
          ]),
        ).pipe(Effect.scoped),
      );
      expectTaggedFailure(exit, "ListenUseProtocol");
      expect(Exit.isFailure(exit)).toBe(true);
    }).pipe(Effect.timeout(Duration.seconds(10))),
  );
});

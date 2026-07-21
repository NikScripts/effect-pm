import { Clock, Context, Duration, Effect, Exit, Layer, Schema } from "effect";
import { describe, it } from "@effect/vitest";
import { expect } from "vitest";
import * as Resource from "../src/Resource";
import * as Node from "../src/Node";
import { expectTaggedFailure } from "./fixtures/expectTaggedFailure";

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/effect-pm-ws-${label}-${process.pid}-${now}.sock`;
  });

class JobsAnon extends Resource.Tag<JobsAnon>()("ws/JobsAnon", {
  jobs: Resource.effect(Schema.Number),
}) {}

describe("Node.ws", () => {
  it.effect("node+serves — fixed localhost port + Lookup; client dials", () =>
    Effect.gen(function* () {
      const port = 20000 + (process.pid % 1000);
      const lookupPath = yield* tmpSock("bound-lookup");
      class Worker extends Node.Tag<Worker>("ws/Worker", {
        url: `ws://127.0.0.1:${String(port)}/rpc`,
        kind: "WebSocket",
      }) {}
      class Jobs extends Resource.Tag<Jobs>()("ws/Jobs", {
        jobs: Resource.effect(Schema.Number),
      }).pipe(Resource.andNode(Worker)) {}

      const serverCtx = yield* Layer.build(
        Node.ws(Worker, [Resource.serve(Jobs, { jobs: Effect.succeed(11) })], {
          lookupPath,
          unlinkLookup: true,
        }),
      );
      const clientCtx = yield* Layer.build(Resource.client(Jobs));

      const n = yield* Effect.gen(function* () {
        const jobs = yield* Jobs;
        return yield* jobs.jobs;
      }).pipe(Effect.provide(Context.merge(serverCtx, clientCtx)));

      expect(n).toBe(11);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
  );

  it.effect("nameless serve — WebSocket + Lookup; discoverClient dials", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("lookup");
      const serverCtx = yield* Layer.build(
        Node.ws(Resource.serve(JobsAnon, { jobs: Effect.succeed(5) }), {
          lookupPath,
          unlinkLookup: true,
        }),
      );
      const clientCtx = yield* Layer.build(
        Resource.discoverClient(JobsAnon, { lookupPath, unlink: false }),
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

  it.effect("rejects Ipc Node with WsListenRequiresWs", () =>
    Effect.gen(function* () {
      class IpcWorker extends Node.Tag<IpcWorker>("ws/IpcWorker", {
        path: "/tmp/effect-pm-ws-reject.sock",
      }) {}
      const exit = yield* Effect.exit(
        Layer.build(
          Node.ws(IpcWorker, [
            Resource.serve(JobsAnon, { jobs: Effect.succeed(1) }),
          ]),
        ).pipe(Effect.scoped),
      );
      expectTaggedFailure(exit, "WsListenRequiresWs");
      expect(Exit.isFailure(exit)).toBe(true);
    }).pipe(Effect.timeout(Duration.seconds(10))),
  );

  it.effect("listen on WebSocket Node fails with ListenUseProtocol", () =>
    Effect.gen(function* () {
      class Worker extends Node.Tag<Worker>("ws/ListenReject", {
        url: "ws://127.0.0.1:9/rpc",
        kind: "WebSocket",
      }) {}
      const exit = yield* Effect.exit(
        Layer.build(
          Node.listen(Worker, [
            Resource.serve(JobsAnon, { jobs: Effect.succeed(1) }),
          ]),
        ).pipe(Effect.scoped),
      );
      expectTaggedFailure(exit, "ListenUseProtocol");
      expect(Exit.isFailure(exit)).toBe(true);
    }).pipe(Effect.timeout(Duration.seconds(10))),
  );
});

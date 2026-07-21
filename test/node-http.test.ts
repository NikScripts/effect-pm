import { Clock, Context, Duration, Effect, Exit, Layer, Schema } from "effect";
import { describe, it } from "@effect/vitest";
import { expect } from "vitest";
import * as Resource from "../src/Resource";
import * as Node from "../src/Node";
import { expectTaggedFailure } from "./fixtures/expectTaggedFailure";

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/effect-pm-http-${label}-${process.pid}-${now}.sock`;
  });

class JobsAnon extends Resource.Tag<JobsAnon>()("http/JobsAnon", {
  jobs: Resource.effect(Schema.Number),
}) {}

describe("Node.http", () => {
  it.effect("node+serves — fixed localhost port + Lookup; client dials", () =>
    Effect.gen(function* () {
      // Pid-scoped port avoids parallel-worker collisions without a reserve dance.
      const port = 19000 + (process.pid % 1000);
      const lookupPath = yield* tmpSock("bound-lookup");
      class Worker extends Node.Tag<Worker>("http/Worker", {
        url: `http://127.0.0.1:${String(port)}/rpc`,
        kind: "Http",
      }) {}
      class Jobs extends Resource.Tag<Jobs>()("http/Jobs", {
        jobs: Resource.effect(Schema.Number),
      }).pipe(Resource.andNode(Worker)) {}

      const serverCtx = yield* Layer.build(
        Node.http(Worker, [Resource.serve(Jobs, { jobs: Effect.succeed(11) })], {
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

  it.effect("nameless serve — Http + Lookup; discoverClient dials", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("lookup");
      const serverCtx = yield* Layer.build(
        Node.http(Resource.serve(JobsAnon, { jobs: Effect.succeed(5) }), {
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
      expect(listenNode.kind).toBe("Http");
      expect(listenNode.url?.startsWith("http://127.0.0.1:")).toBe(true);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
  );

  it.effect("rejects Ipc Node with HttpListenRequiresHttp", () =>
    Effect.gen(function* () {
      class IpcWorker extends Node.Tag<IpcWorker>("http/IpcWorker", {
        path: "/tmp/effect-pm-http-reject.sock",
      }) {}
      const exit = yield* Effect.exit(
        Layer.build(
          Node.http(IpcWorker, [
            Resource.serve(JobsAnon, { jobs: Effect.succeed(1) }),
          ]),
        ).pipe(Effect.scoped),
      );
      expectTaggedFailure(exit, "HttpListenRequiresHttp");
      expect(Exit.isFailure(exit)).toBe(true);
    }).pipe(Effect.timeout(Duration.seconds(10))),
  );

  it.effect("listen on Http Node fails with ListenUseProtocol", () =>
    Effect.gen(function* () {
      class Worker extends Node.Tag<Worker>("http/ListenReject", {
        url: "http://127.0.0.1:9/rpc",
        kind: "Http",
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

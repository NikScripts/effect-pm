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
    return `/tmp/hyperlink-ts-http-${label}-${process.pid}-${now}.sock`;
  });

class JobsAnon extends Hyperlink.Tag<JobsAnon>()("http/JobsAnon", {
  jobs: Hyperlink.effect(Schema.Number),
}) {}

describe("Node.http", () => {
  it.effect("node+serves — fixed localhost port + Lookup; client dials", () =>
    Effect.gen(function* () {
      // Pid-scoped port avoids parallel-worker collisions without a reserve dance.
      const port = 19000 + (process.pid % 1000);
      const lookupPath = yield* tmpSock("bound-lookup");
      class Worker extends Node.Tag<Worker>()("http/Worker", {
        url: `http://127.0.0.1:${String(port)}/rpc`,
        kind: "Http",
      }) {}
      class Jobs extends Hyperlink.Tag<Jobs>()("http/Jobs", {
        jobs: Hyperlink.effect(Schema.Number),
      }).pipe(Hyperlink.andNode(Worker)) {}

      const serverCtx = yield* Layer.build(
        Node.http(Worker, [Hyperlink.serve(Jobs, { jobs: Effect.succeed(11) })]).pipe(
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

  it.effect("nameless serve — Http + Lookup; Hyperlink.unix(tag) dials", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("lookup");
      const serverCtx = yield* Layer.build(
        Node.http(Hyperlink.serve(JobsAnon, { jobs: Effect.succeed(5) })).pipe(
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
      expect(listenNode.kind).toBe("Http");
      expect(listenNode.url?.startsWith("http://127.0.0.1:")).toBe(true);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
  );

  it.effect("nameless serve — fixed port shorthand; client dials that url", () =>
    Effect.gen(function* () {
      const port = 19100 + (process.pid % 1000);
      const lookupPath = yield* tmpSock("fixed-port");
      const serverCtx = yield* Layer.build(
        Node.http(
          Hyperlink.serve(JobsAnon, { jobs: Effect.succeed(9) }),
          port,
        ).pipe(
          Layer.provide(
            Lookup.layerOptions({ path: lookupPath, unlink: true }),
          ),
        ),
      );
      const listenNode = Context.get(serverCtx, Node.ListenNode);
      expect(listenNode.url).toBe(`http://127.0.0.1:${String(port)}/rpc`);
      const clientCtx = yield* Layer.build(
        Hyperlink.connect(JobsAnon, Hyperlink.protocolHttp(port)),
      );
      const n = yield* Effect.gen(function* () {
        const jobs = yield* JobsAnon;
        return yield* jobs.jobs;
      }).pipe(Effect.provide(Context.merge(serverCtx, clientCtx)));
      expect(n).toBe(9);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
  );

  it.effect("nameless serve — :port and url string shorthand", () =>
    Effect.gen(function* () {
      const port = 19150 + (process.pid % 500);
      const urlCtx = yield* Layer.build(
        Node.http(
          Hyperlink.serve(JobsAnon, { jobs: Effect.succeed(2) }),
          `http://127.0.0.1:${String(port)}/rpc`,
        ).pipe(Layer.provide(Lookup.layer)),
      );
      expect(Context.get(urlCtx, Node.ListenNode).url).toBe(
        `http://127.0.0.1:${String(port)}/rpc`,
      );
      const colonPort = port + 1;
      const colonCtx = yield* Layer.build(
        Node.http(
          Hyperlink.serve(JobsAnon, { jobs: Effect.succeed(3) }),
          `:${String(colonPort)}` as `:${number}`,
        ).pipe(Layer.provide(Lookup.layer)),
      );
      expect(Context.get(colonCtx, Node.ListenNode).url).toBe(
        `http://127.0.0.1:${String(colonPort)}/rpc`,
      );
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
  );

  it.effect("rejects Ipc Node with HttpListenRequiresHttp", () =>
    Effect.gen(function* () {
      class IpcWorker extends Node.Tag<IpcWorker>()("http/IpcWorker", {
        path: "/tmp/hyperlink-ts-http-reject.sock",
      }) {}
      const exit = yield* Effect.exit(
        Layer.build(
          Node.http(IpcWorker, [
            Hyperlink.serve(JobsAnon, { jobs: Effect.succeed(1) }),
          ]),
        ).pipe(Effect.scoped),
      );
      expectTaggedFailure(exit, "HttpListenRequiresHttp");
      expect(Exit.isFailure(exit)).toBe(true);
    }).pipe(Effect.timeout(Duration.seconds(10))),
  );

  it.effect("listen on Http Node fails with ListenUseProtocol", () =>
    Effect.gen(function* () {
      class Worker extends Node.Tag<Worker>()("http/ListenReject", {
        url: "http://127.0.0.1:9/rpc",
        kind: "Http",
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

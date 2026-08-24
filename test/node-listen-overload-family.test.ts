import { Clock, Context, Duration, Effect, Layer, Schema } from "effect";
import { describe, it } from "@effect/vitest";
import { expect } from "vitest";
import * as Hyperlink from "../src/Hyperlink";
import * as Lookup from "../src/Lookup";
import * as Node from "../src/Node";

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/hyperlink-ts-listen-family-${label}-${process.pid}-${now}.sock`;
  });

class Jobs extends Hyperlink.Service<Jobs>()("listen-family/Jobs", {
  jobs: Hyperlink.effect(Schema.Number),
}) {}

describe("listen overload family (aligned siblings)", () => {
  it.effect("http — unbound Tag+impl + port (nameless; Lookup Soft-baked)", () =>
    Effect.gen(function* () {
      const port = 19300 + (process.pid % 500);
      // No Lookup.layer pipe — Soft-bake supplies default Identity / advertise.
      const serverCtx = yield* Layer.build(
        Node.http(Jobs, { jobs: Effect.succeed(4) }, port),
      );
      expect(Context.get(serverCtx, Node.ListenNode).url).toBe(
        `http://127.0.0.1:${String(port)}/rpc`,
      );
      const clientCtx = yield* Layer.build(
        Hyperlink.connect(Jobs, Hyperlink.protocolHttp(port)),
      );
      const n = yield* Effect.gen(function* () {
        const jobs = yield* Jobs;
        return yield* jobs.jobs;
      }).pipe(Effect.provide(Context.merge(serverCtx, clientCtx)));
      expect(n).toBe(4);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
  );

  it.effect("http — no node, no address, no Lookup pipe (ephemeral Soft-bake)", () =>
    Effect.gen(function* () {
      const serverCtx = yield* Layer.build(
        Node.http(Jobs, { jobs: Effect.succeed(11) }),
      );
      const listenNode = Context.get(serverCtx, Node.ListenNode);
      expect(listenNode.key.startsWith("hyperlink-ts/anonymous-node/")).toBe(
        true,
      );
      expect(listenNode.url?.startsWith("http://127.0.0.1:")).toBe(true);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
  );

  it.effect("http — Tag+impl + Node (no andNode)", () =>
    Effect.gen(function* () {
      const port = 19350 + (process.pid % 400);
      class Worker extends Node.Service<Worker>()("listen-family/WorkerHttp", {
        url: `http://127.0.0.1:${String(port)}/rpc`,
        kind: "Http",
      }) {}
      const serverCtx = yield* Layer.build(
        Node.http(Jobs, { jobs: Effect.succeed(5) }, Worker).pipe(
          Layer.provide(Lookup.layer),
        ),
      );
      expect(Context.get(serverCtx, Node.ListenNode).key).toBe(Worker.key);
      const clientCtx = yield* Layer.build(
        Hyperlink.connect(Jobs, Hyperlink.protocolHttp(port)),
      );
      const n = yield* Effect.gen(function* () {
        const jobs = yield* Jobs;
        return yield* jobs.jobs;
      }).pipe(Effect.provide(Context.merge(serverCtx, clientCtx)));
      expect(n).toBe(5);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
  );

  it.effect("http — single serve layer + port (no brackets)", () =>
    Effect.gen(function* () {
      const port = 19400 + (process.pid % 300);
      const serverCtx = yield* Layer.build(
        Node.http(Hyperlink.serve(Jobs, { jobs: Effect.succeed(6) }), port),
      );
      expect(Context.get(serverCtx, Node.ListenNode).url).toBe(
        `http://127.0.0.1:${String(port)}/rpc`,
      );
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
  );

  it.effect("unix — unbound Tag+impl nameless; unix(tag) dials", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("unix-tag");
      const serverCtx = yield* Layer.build(
        Node.unix(Jobs, { jobs: Effect.succeed(7) }).pipe(
          Layer.provide(
            Lookup.layerOptions({ path: lookupPath, unlink: true }),
          ),
        ),
      );
      const clientCtx = yield* Layer.build(
        Hyperlink.unix(Jobs, { lookupPath, unlink: false }),
      );
      const n = yield* Effect.gen(function* () {
        const jobs = yield* Jobs;
        return yield* jobs.jobs;
      }).pipe(Effect.provide(Context.merge(serverCtx, clientCtx)));
      expect(n).toBe(7);
      expect(
        Context.get(serverCtx, Node.ListenNode).key.startsWith(
          "hyperlink-ts/anonymous-node/",
        ),
      ).toBe(true);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
  );

  it.effect("unix — Tag+impl + Node", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("unix-node");
      const lookupPath = yield* tmpSock("unix-node-lookup");
      class Worker extends Node.Service<Worker>()("listen-family/WorkerUnix", {
        path,
      }) {}
      const serverCtx = yield* Layer.build(
        Node.unix(Jobs, { jobs: Effect.succeed(8) }, Worker).pipe(
          Layer.provide(
            Lookup.layerOptions({ path: lookupPath, unlink: true }),
          ),
        ),
      );
      expect(Context.get(serverCtx, Node.ListenNode).path).toBe(path);
      const clientCtx = yield* Layer.build(
        Hyperlink.connect(Jobs, Hyperlink.protocolIpc(path)),
      );
      const n = yield* Effect.gen(function* () {
        const jobs = yield* Jobs;
        return yield* jobs.jobs;
      }).pipe(Effect.provide(Context.merge(serverCtx, clientCtx)));
      expect(n).toBe(8);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
  );

  it.effect("ws — unbound Tag+impl + port (Lookup Soft-baked)", () =>
    Effect.gen(function* () {
      const port = 19450 + (process.pid % 200);
      const serverCtx = yield* Layer.build(
        Node.ws(Jobs, { jobs: Effect.succeed(9) }, port),
      );
      expect(Context.get(serverCtx, Node.ListenNode).url).toBe(
        `ws://127.0.0.1:${String(port)}/rpc`,
      );
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
  );
});

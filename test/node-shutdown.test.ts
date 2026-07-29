/**
 * `Node.shutdown` — drain + leave Directory; `Node.launch` exits on shutdown.
 */
import {
  Clock,
  Context,
  Duration,
  Effect,
  Fiber,
  Layer,
  Schema,
} from "effect";
import { describe, expect, it } from "@effect/vitest";
import * as Hyperlink from "../src/Hyperlink";
import * as Lookup from "../src/Lookup";
import * as Node from "../src/Node";

class Jobs extends Hyperlink.Tag<Jobs>()("shutdown/Jobs", {
  ping: Hyperlink.effect(Schema.String),
}) {}

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/hyperlink-ts-shutdown-${label}-${process.pid}-${now}.sock`;
  });

describe("Node.shutdown", () => {
  it.live("drains and unregisters the Directory row", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("lookup");
      const workerPath = yield* tmpSock("worker");
      const lookupNode = Node.Tag()("shutdown/lookup", {
        path: lookupPath,
      }).pipe(Node.asLookup);

      class Worker extends Node.Tag<Worker, Jobs>()("shutdown/Worker", {
        path: workerPath,
      }) {}

      const lookupServer = yield* Layer.build(Lookup.layerNode(lookupNode));
      const lookupClient = yield* Layer.build(Lookup.client(lookupNode));
      const lookupCtx = Context.merge(lookupServer, lookupClient);
      const dir = Context.get(lookupCtx, Lookup.Directory);

      const workerCtx = yield* Layer.build(
        Node.unix(Worker, [
          Hyperlink.serve(Jobs, { ping: Effect.succeed("ok") }),
        ]).pipe(Layer.provide(Lookup.client(lookupNode))),
      );

      const before = yield* dir
        .nodesServing(
          new Lookup.NodesServingRequest({
            serviceKey: "shutdown/Jobs",
          }),
        )
        .pipe(Effect.provide(lookupCtx));
      expect(before).toHaveLength(1);

      yield* Node.shutdown(Worker);

      yield* Effect.sleep(Duration.millis(100));
      const after = yield* dir
        .nodesServing(
          new Lookup.NodesServingRequest({
            serviceKey: "shutdown/Jobs",
          }),
        )
        .pipe(Effect.provide(lookupCtx));
      expect(after).toHaveLength(0);

      yield* Effect.sync(() => {
        void workerCtx;
      });
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
  );

  it.live("Node.launch exits when Node.shutdown is dialed", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("launch-lookup");
      const workerPath = yield* tmpSock("launch-worker");
      const lookupNode = Node.Tag()("shutdown/launch-lookup", {
        path: lookupPath,
      }).pipe(Node.asLookup);

      class Worker extends Node.Tag<Worker, Jobs>()("shutdown/LaunchWorker", {
        path: workerPath,
      }) {}

      yield* Layer.build(Lookup.layerNode(lookupNode));
      const lookupClient = Lookup.client(lookupNode);

      const listenFiber = yield* Effect.forkScoped(
        Node.launch(
          Worker,
          Node.unix(Worker, [
            Hyperlink.serve(Jobs, { ping: Effect.succeed("ok") }),
          ]).pipe(Layer.provide(lookupClient)),
        ),
      );

      yield* Effect.sleep(Duration.millis(200));
      yield* Node.shutdown(Worker);

      yield* Fiber.join(listenFiber).pipe(
        Effect.timeout(Duration.seconds(5)),
      );
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
  );
});

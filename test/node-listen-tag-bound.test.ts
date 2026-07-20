import { Clock, Context, Duration, Effect, Layer, Schema } from "effect";
import { describe, it } from "@effect/vitest";
import { expect } from "vitest";
import * as Resource from "../src/Resource";
import * as Node from "../src/Node";
import { expectTaggedFailure } from "./fixtures/expectTaggedFailure";

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/effect-pm-listen-tag-${label}-${process.pid}-${now}.sock`;
  });

/** Bypass NodeBoundTag overload so the runtime fail-closed path can be exercised. */
const listenTagErased = Node.listen as unknown as (
  tag: Resource.PipeableTag,
  impl: unknown,
  options?: Node.ListenOptions,
) => Layer.Layer<never, Node.ListenTagNodeRequired>;

describe("Node.listen(Tag, impl) sole-bound node", () => {
  it.effect("listens on the Tag's node; client(Tag) dials", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("bound");
      class Worker extends Node.Tag<Worker>("listen-tag/Worker", { path }) {}
      class Jobs extends Resource.Tag<Jobs>()("listen-tag/Jobs", {
        jobs: Resource.effect(Schema.Number),
      }).pipe(Resource.andNode(Worker)) {}

      const serverCtx = yield* Layer.build(
        Node.listen(Jobs, { jobs: Effect.succeed(11) }),
      );
      const clientCtx = yield* Layer.build(Resource.client(Jobs));

      const n = yield* Effect.gen(function* () {
        const jobs = yield* Jobs;
        return yield* jobs.jobs;
      }).pipe(Effect.provide(Context.merge(serverCtx, clientCtx)));

      expect(n).toBe(11);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
  );

  it.effect("fails ListenTagNodeRequired when Tag has no Node", () =>
    Effect.gen(function* () {
      class Jobs extends Resource.Tag<Jobs>()("listen-tag/MissingJobs", {
        jobs: Resource.effect(Schema.Number),
      }) {}

      const exit = yield* Effect.exit(
        Layer.build(
          listenTagErased(Jobs, { jobs: Effect.succeed(1) }),
        ).pipe(Effect.scoped),
      );
      expectTaggedFailure(exit, "ListenTagNodeRequired");
    }).pipe(Effect.timeout(Duration.seconds(10))),
  );

  it.effect("fails ListenTagNodeRequired when Tag has multiple Nodes", () =>
    Effect.gen(function* () {
      const pathA = yield* tmpSock("a");
      const pathB = yield* tmpSock("b");
      class NodeA extends Node.Tag<NodeA>("listen-tag/A", { path: pathA }) {}
      class NodeB extends Node.Tag<NodeB>("listen-tag/B", { path: pathB }) {}
      class Jobs extends Resource.Tag<Jobs>()("listen-tag/MultiJobs", {
        jobs: Resource.effect(Schema.Number),
      }).pipe(Resource.nodes([NodeA, NodeB])) {}

      const exit = yield* Effect.exit(
        Layer.build(
          listenTagErased(Jobs, { jobs: Effect.succeed(1) }),
        ).pipe(Effect.scoped),
      );
      expectTaggedFailure(exit, "ListenTagNodeRequired");
    }).pipe(Effect.timeout(Duration.seconds(10))),
  );
});

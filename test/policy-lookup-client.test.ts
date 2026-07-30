/**
 * Policy + lookupClient — warm sticky dual-serve and continuous streams.
 */
import {
  Clock,
  Context,
  Duration,
  Effect,
  Fiber,
  Layer,
  PubSub,
  Ref,
  Schedule,
  Schema,
  Stream,
} from "effect";
import { describe, expect, it } from "@effect/vitest";
import * as Hyperlink from "../src/Hyperlink";
import * as Lookup from "../src/Lookup";
import * as Advice from "../src/Advice";
import * as Directory from "../src/Directory";
import * as Policy from "../src/Policy";
import * as Node from "../src/Node";
import { expectTaggedFailure } from "./fixtures/expectTaggedFailure";

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/hyperlink-ts-policy-${label}-${process.pid}-${now}.sock`;
  });

class Jobs extends Hyperlink.Tag<Jobs>()("policy/Jobs", {
  jobs: Hyperlink.effect(Schema.Number),
  ticks: Hyperlink.stream(Schema.Number),
}) {}

describe("Policy + lookupClient", () => {
  it.live("warm sticky: stay on A when B appears without Advice", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("sticky-lookup");
      const workerAPath = yield* tmpSock("sticky-a");
      const workerBPath = yield* tmpSock("sticky-b");

      const lookupNode = Node.Tag()("policy/sticky-lookup", {
        path: lookupPath,
      }).pipe(Node.asLookup);

      class WorkerA extends Node.Tag<WorkerA, Jobs>()("policy/StickyA", {
        path: workerAPath,
      }) {}
      class WorkerB extends Node.Tag<WorkerB, Jobs>()("policy/StickyB", {
        path: workerBPath,
      }) {}

      const lookupClientLayer = Lookup.client(lookupNode);
      yield* Layer.build(Lookup.layerNode(lookupNode));
      const lookupCtx = yield* Layer.build(lookupClientLayer);

      yield* Layer.build(
        Node.unix(WorkerA, [
          Hyperlink.serve(Jobs, {
            jobs: Effect.succeed(5),
            ticks: Stream.empty,
          }),
        ]).pipe(Layer.provide(lookupClientLayer)),
      );

      const clientCtx = yield* Layer.build(
        Hyperlink.lookupClient(Jobs).pipe(Layer.provide(lookupClientLayer)),
      );

      const readJobs = Effect.gen(function* () {
        const jobs = yield* Jobs;
        return yield* jobs.jobs;
      }).pipe(Effect.provide(Context.merge(lookupCtx, clientCtx)));

      expect(yield* readJobs).toBe(5);

      yield* Layer.build(
        Node.unix(WorkerB, [
          Hyperlink.serve(Jobs, {
            jobs: Effect.succeed(9),
            ticks: Stream.empty,
          }),
        ]).pipe(Layer.provide(lookupClientLayer)),
      );

      // Both Directory-visible, no Advice — sticky keeps A.
      yield* Effect.sleep(Duration.millis(100));
      const rows = yield* Directory.nodesServing(Jobs).pipe(
        Effect.provide(lookupCtx),
      );
      expect(rows.length).toBe(2);
      expect(yield* readJobs).toBe(5);

      yield* Advice.prefer(Jobs, WorkerB.key).pipe(Effect.provide(lookupCtx));
      yield* Effect.repeat(readJobs, {
        until: (n) => n === 9,
        schedule: Schedule.spaced(Duration.millis(25)),
      });
      expect(yield* readJobs).toBe(9);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(30))),
  );

  it.live("cold N>1 without Advice still LookupClientError ambiguous", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("cold-lookup");
      const workerAPath = yield* tmpSock("cold-a");
      const workerBPath = yield* tmpSock("cold-b");

      const lookupNode = Node.Tag()("policy/cold-lookup", {
        path: lookupPath,
      }).pipe(Node.asLookup);

      class WorkerA extends Node.Tag<WorkerA, Jobs>()("policy/ColdA", {
        path: workerAPath,
      }) {}
      class WorkerB extends Node.Tag<WorkerB, Jobs>()("policy/ColdB", {
        path: workerBPath,
      }) {}

      const lookupClientLayer = Lookup.client(lookupNode);
      yield* Layer.build(Lookup.layerNode(lookupNode));

      yield* Layer.build(
        Node.unix(WorkerA, [
          Hyperlink.serve(Jobs, {
            jobs: Effect.succeed(5),
            ticks: Stream.empty,
          }),
        ]).pipe(Layer.provide(lookupClientLayer)),
      );
      yield* Layer.build(
        Node.unix(WorkerB, [
          Hyperlink.serve(Jobs, {
            jobs: Effect.succeed(9),
            ticks: Stream.empty,
          }),
        ]).pipe(Layer.provide(lookupClientLayer)),
      );

      const exit = yield* Effect.exit(
        Layer.build(
          Hyperlink.lookupClient(Jobs).pipe(Layer.provide(lookupClientLayer)),
        ),
      );
      expectTaggedFailure(exit, "LookupClientError");
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(30))),
  );

  it.live("Policy.pick + provide: cold pickFirst via fragment", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("pick-lookup");
      const workerAPath = yield* tmpSock("pick-a");
      const workerBPath = yield* tmpSock("pick-b");

      const lookupNode = Node.Tag()("policy/pick-lookup", {
        path: lookupPath,
      }).pipe(Node.asLookup);

      class WorkerA extends Node.Tag<WorkerA, Jobs>()("policy/PickA", {
        path: workerAPath,
      }) {}
      class WorkerB extends Node.Tag<WorkerB, Jobs>()("policy/PickB", {
        path: workerBPath,
      }) {}

      const lookupClientLayer = Lookup.client(lookupNode);
      yield* Layer.build(Lookup.layerNode(lookupNode));
      const lookupCtx = yield* Layer.build(lookupClientLayer);

      yield* Layer.build(
        Node.unix(WorkerA, [
          Hyperlink.serve(Jobs, {
            jobs: Effect.succeed(5),
            ticks: Stream.empty,
          }),
        ]).pipe(Layer.provide(lookupClientLayer)),
      );
      yield* Layer.build(
        Node.unix(WorkerB, [
          Hyperlink.serve(Jobs, {
            jobs: Effect.succeed(9),
            ticks: Stream.empty,
          }),
        ]).pipe(Layer.provide(lookupClientLayer)),
      );

      const clientCtx = yield* Layer.build(
        Hyperlink.lookupClient(Jobs).pipe(
          Policy.provide(Policy.coldAmbiguous("pickFirst")),
          Layer.provide(lookupClientLayer),
        ),
      );

      const n = yield* Effect.gen(function* () {
        const jobs = yield* Jobs;
        return yield* jobs.jobs;
      }).pipe(Effect.provide(Context.merge(lookupCtx, clientCtx)));

      // nodesServing order is not guaranteed — just that cold pickFirst dials some row.
      expect(n === 5 || n === 9).toBe(true);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(30))),
  );

  it.live("continuous stream: one fold across Advice prefer A→B", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("stream-lookup");
      const workerAPath = yield* tmpSock("stream-a");
      const workerBPath = yield* tmpSock("stream-b");

      const lookupNode = Node.Tag()("policy/stream-lookup", {
        path: lookupPath,
      }).pipe(Node.asLookup);

      class WorkerA extends Node.Tag<WorkerA, Jobs>()("policy/StreamA", {
        path: workerAPath,
      }) {}
      class WorkerB extends Node.Tag<WorkerB, Jobs>()("policy/StreamB", {
        path: workerBPath,
      }) {}

      const lookupClientLayer = Lookup.client(lookupNode);
      yield* Layer.build(Lookup.layerNode(lookupNode));
      const lookupCtx = yield* Layer.build(lookupClientLayer);

      const hubA = yield* PubSub.unbounded<number>();
      const hubB = yield* PubSub.unbounded<number>();

      yield* Layer.build(
        Node.unix(WorkerA, [
          Hyperlink.serve(Jobs, {
            jobs: Effect.succeed(5),
            ticks: Stream.fromPubSub(hubA),
          }),
        ]).pipe(Layer.provide(lookupClientLayer)),
      );
      yield* Layer.build(
        Node.unix(WorkerB, [
          Hyperlink.serve(Jobs, {
            jobs: Effect.succeed(9),
            ticks: Stream.fromPubSub(hubB),
          }),
        ]).pipe(Layer.provide(lookupClientLayer)),
      );

      yield* Advice.prefer(Jobs, WorkerA.key).pipe(Effect.provide(lookupCtx));

      const clientCtx = yield* Layer.build(
        Hyperlink.lookupClient(Jobs).pipe(
          Policy.provide(Policy.streamGap("stall")),
          Layer.provide(lookupClientLayer),
        ),
      );

      const seen = yield* Ref.make<ReadonlyArray<number>>([]);
      const fiber = yield* Effect.forkChild(
        Effect.gen(function* () {
          const jobs = yield* Jobs;
          yield* jobs.ticks.pipe(
            Stream.take(2),
            Stream.runForEach((n) => Ref.update(seen, (xs) => [...xs, n])),
          );
        }).pipe(Effect.provide(Context.merge(lookupCtx, clientCtx))),
      );

      yield* Effect.sleep(Duration.millis(50));
      yield* PubSub.publish(hubA, 1);
      yield* Effect.repeat(Ref.get(seen), {
        until: (xs) => xs.includes(1),
        schedule: Schedule.spaced(Duration.millis(25)),
      });

      yield* Advice.prefer(Jobs, WorkerB.key).pipe(Effect.provide(lookupCtx));
      yield* Effect.sleep(Duration.millis(100));
      yield* PubSub.publish(hubB, 2);

      yield* Fiber.join(fiber);
      const values = yield* Ref.get(seen);
      expect(values).toContain(1);
      expect(values).toContain(2);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(30))),
  );
});

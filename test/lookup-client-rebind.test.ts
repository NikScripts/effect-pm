/**
 * Track D — `lookupClient` hot-rebinds on Directory dial moves (mirror peersLayer)
 * and transparently retries Effect RPCs across the A→B gap.
 */
import {
  Clock,
  Context,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Ref,
  Schedule,
  Schema,
} from "effect";
import { describe, expect, it } from "@effect/vitest";
import * as Hyperlink from "../src/Hyperlink";
import * as Lookup from "../src/Lookup";
import * as Node from "../src/Node";

class Jobs extends Hyperlink.Tag<Jobs>()("lc-rebind/Jobs", {
  jobs: Hyperlink.effect(Schema.Number),
}) {}

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/hyperlink-ts-lc-rebind-${label}-${process.pid}-${now}.sock`;
  });

describe("Hyperlink.lookupClient hot-rebind", () => {
  it.live("rebuilds dial when Directory row moves A→B", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("lookup");
      const workerAPath = yield* tmpSock("worker-a");
      const workerBPath = yield* tmpSock("worker-b");

      const lookupNode = Node.Tag()("lc-rebind/lookup", {
        path: lookupPath,
      }).pipe(Node.asLookup);

      class WorkerA extends Node.Tag<WorkerA, Jobs>()("lc-rebind/Worker", {
        path: workerAPath,
      }) {}

      const lookupClientLayer = Lookup.client(lookupNode);
      yield* Layer.build(Lookup.layerNode(lookupNode));
      const lookupCtx = yield* Layer.build(lookupClientLayer);

      const workerA = yield* Layer.build(
        Node.unix(WorkerA, [
          Hyperlink.serve(Jobs, { jobs: Effect.succeed(5) }),
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
      yield* Effect.sync(() => {
        void workerA;
      });

      yield* Node.shutdown(WorkerA);

      const dir = Context.get(lookupCtx, Lookup.Directory);
      yield* Effect.repeat(
        dir
          .nodesServing(
            new Lookup.NodesServingRequest({
              serviceKey: "lc-rebind/Jobs",
            }),
          )
          .pipe(
            Effect.provide(lookupCtx),
            Effect.map((rows) => rows.length === 0),
          ),
        {
          until: (empty) => empty,
          schedule: Schedule.spaced(Duration.millis(25)),
        },
      );

      class WorkerB extends Node.Tag<WorkerB, Jobs>()("lc-rebind/Worker", {
        path: workerBPath,
      }) {}

      const workerB = yield* Layer.build(
        Node.unix(WorkerB, [
          Hyperlink.serve(Jobs, { jobs: Effect.succeed(9) }),
        ]).pipe(Layer.provide(lookupClientLayer)),
      );

      yield* Effect.repeat(readJobs, {
        until: (n) => n === 9,
        schedule: Schedule.spaced(Duration.millis(25)),
      });
      expect(yield* readJobs).toBe(9);
      yield* Effect.sync(() => {
        void workerB;
      });
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(30))),
  );

  it.live(
    "transparent retry: concurrent calls survive A→B when B is Directory-visible first",
    () =>
      Effect.gen(function* () {
        const lookupPath = yield* tmpSock("lookup-retry");
        const workerAPath = yield* tmpSock("worker-a-retry");
        const workerBPath = yield* tmpSock("worker-b-retry");

        const lookupNode = Node.Tag()("lc-rebind/lookup-retry", {
          path: lookupPath,
        }).pipe(Node.asLookup);

        class WorkerA extends Node.Tag<WorkerA, Jobs>()("lc-rebind/WorkerA", {
          path: workerAPath,
        }) {}
        class WorkerB extends Node.Tag<WorkerB, Jobs>()("lc-rebind/WorkerB", {
          path: workerBPath,
        }) {}

        const lookupClientLayer = Lookup.client(lookupNode);
        yield* Layer.build(Lookup.layerNode(lookupNode));
        const lookupCtx = yield* Layer.build(lookupClientLayer);

        // B first — Directory peer present before A leaves (dream cutover order).
        yield* Layer.build(
          Node.unix(WorkerB, [
            Hyperlink.serve(Jobs, { jobs: Effect.succeed(9) }),
          ]).pipe(Layer.provide(lookupClientLayer)),
        );
        yield* Layer.build(
          Node.unix(WorkerA, [
            Hyperlink.serve(Jobs, { jobs: Effect.succeed(5) }),
          ]).pipe(Layer.provide(lookupClientLayer)),
        );

        yield* Lookup.advise({
          serviceKey: Jobs.key,
          prefer: WorkerA.key,
        }).pipe(Effect.provide(lookupCtx));

        const clientCtx = yield* Layer.build(
          Hyperlink.lookupClient(Jobs).pipe(Layer.provide(lookupClientLayer)),
        );

        const readJobs = Effect.gen(function* () {
          const jobs = yield* Jobs;
          return yield* jobs.jobs;
        }).pipe(Effect.provide(Context.merge(lookupCtx, clientCtx)));

        expect(yield* readJobs).toBe(5);

        const failures = yield* Ref.make(0);
        const last = yield* Ref.make(5);
        const hammer = Effect.forever(
          Effect.gen(function* () {
            const exit = yield* Effect.exit(readJobs);
            if (Exit.isFailure(exit)) {
              yield* Ref.update(failures, (n) => n + 1);
            } else {
              yield* Ref.set(last, exit.value);
            }
            yield* Effect.sleep(Duration.millis(20));
          }),
        );
        const fiber = yield* Effect.forkChild(hammer);

        // Move dialers to B, then shut A — concurrent reads must not surface RpcClientError.
        yield* Lookup.advise({
          serviceKey: Jobs.key,
          prefer: WorkerB.key,
        }).pipe(Effect.provide(lookupCtx));
        yield* Effect.sleep(Duration.millis(100));
        yield* Node.shutdown(WorkerA);

        yield* Effect.repeat(Ref.get(last), {
          until: (n) => n === 9,
          schedule: Schedule.spaced(Duration.millis(25)),
        });
        yield* Effect.sleep(Duration.millis(200));
        yield* Fiber.interrupt(fiber);

        expect(yield* Ref.get(last)).toBe(9);
        expect(yield* Ref.get(failures)).toBe(0);
      }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(30))),
  );
});

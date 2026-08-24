/**
 * Policy fragments — defaults, compose, verify / conflict / yield / dial.
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
import * as Advice from "../src/Advice";
import * as Directory from "../src/Directory";
import * as LookupPolicy from "../src/LookupPolicy";
import * as Node from "../src/Node";
import { expectTaggedFailure } from "./fixtures/expectTaggedFailure";

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/hyperlink-ts-policy-unit-${label}-${process.pid}-${now}.sock`;
  });

class Jobs extends Hyperlink.Service<Jobs>()("policy-unit/Jobs", {
  jobs: Hyperlink.effect(Schema.Number),
}) {}

const jobsImpl = { jobs: Effect.succeed(1) };

/** Read ambient Policy refs after providing fragments. */
const readPolicy = Effect.gen(function* () {
  return {
    sticky: yield* LookupPolicy.Sticky,
    streamGap: yield* LookupPolicy.StreamGap,
    cold: yield* LookupPolicy.ColdAmbiguous,
    pick: yield* LookupPolicy.Pick,
    verify: yield* LookupPolicy.Verify,
    conflict: yield* LookupPolicy.Conflict,
    yield: yield* LookupPolicy.Yield,
  };
});

describe("Policy defaults + compose", () => {
  it.effect("defaults match lean cutover / verify / conflict / yield", () =>
    Effect.gen(function* () {
      const d = yield* readPolicy;
      expect(d.sticky).toBe(true);
      expect(d.streamGap).toBe("stall");
      expect(d.cold).toBe("fail");
      expect(d.pick).toBeUndefined();
      expect(d.verify).toBe("reject");
      expect(d.conflict).toBe("inherit");
      expect(yield* d.yield).toBe(true);
    }),
  );

  it.effect("make sets refs from object form + stamps runtime config", () =>
    Effect.gen(function* () {
      const bundle = LookupPolicy.make({
        Sticky: false,
        StreamGap: "buffer",
        ColdAmbiguous: "pickFirst",
        Pick: "first",
        Verify: false,
        Conflict: "askIncumbent",
        Yield: false,
      });
      expect(LookupPolicy.isPolicy(bundle)).toBe(true);
      expect(LookupPolicy.config(bundle)).toEqual({
        Sticky: false,
        StreamGap: "buffer",
        ColdAmbiguous: "pickFirst",
        Pick: "first",
        Verify: false,
        Conflict: "askIncumbent",
        Yield: false,
      });
      const d = yield* readPolicy.pipe(Effect.provide(bundle));
      expect(d.sticky).toBe(false);
      expect(d.streamGap).toBe("buffer");
      expect(d.cold).toBe("pickFirst");
      expect(d.pick).toBe("first");
      expect(d.verify).toBe(false);
      expect(d.conflict).toBe("askIncumbent");
      expect(yield* d.yield).toBe(false);
    }),
  );

  it.effect("camelCase helpers + fromConfig/toConfig/isFragment match bag stamps", () =>
    Effect.gen(function* () {
      const fromHandles = LookupPolicy.layer(
        LookupPolicy.unsticky,
        LookupPolicy.streamGap("buffer"),
        LookupPolicy.verify(false),
      );
      expect(LookupPolicy.config(fromHandles)).toEqual({
        Sticky: false,
        StreamGap: "buffer",
        Verify: false,
      });
      const tagged = LookupPolicy.streamGap("drop");
      expect(LookupPolicy.config(tagged)).toEqual({ StreamGap: "drop" });
      expect(
        LookupPolicy.isFragment("StreamGap")({ _tag: "StreamGap", value: "drop" }),
      ).toBe(true);
      expect(LookupPolicy.toConfig(LookupPolicy.fromConfig({ Sticky: true }))).toEqual({
        Sticky: true,
      });
      const d = yield* readPolicy.pipe(
        Effect.provide(
          LookupPolicy.layer(fromHandles, tagged, LookupPolicy.yieldRefuse),
        ),
      );
      expect(d.sticky).toBe(false);
      expect(d.streamGap).toBe("drop");
      expect(d.verify).toBe(false);
      expect(yield* d.yield).toBe(false);
    }),
  );

  it.effect("layer pipe + data-first expand config (last write wins)", () =>
    Effect.gen(function* () {
      const piped = LookupPolicy.make({
        StreamGap: "stall",
        Verify: "reject",
        Sticky: true,
      }).pipe(
        LookupPolicy.layer(LookupPolicy.streamGap("buffer")),
        LookupPolicy.layer(LookupPolicy.verifyOff),
        LookupPolicy.layer(LookupPolicy.livenessReplace),
      );
      expect(LookupPolicy.config(piped)).toEqual({
        StreamGap: "buffer",
        Verify: false,
        Sticky: true,
        Conflict: "livenessReplace",
      });

      const dataFirst = LookupPolicy.layer(
        LookupPolicy.make({
          StreamGap: "stall",
          Verify: "reject",
          Sticky: true,
        }),
        LookupPolicy.streamGap("buffer"),
        LookupPolicy.verifyOff,
        LookupPolicy.livenessReplace,
      );
      expect(LookupPolicy.config(dataFirst)).toEqual(LookupPolicy.config(piped));

      const d = yield* readPolicy.pipe(Effect.provide(piped));
      expect(d.sticky).toBe(true);
      expect(d.streamGap).toBe("buffer");
      expect(d.verify).toBe(false);
      expect(d.conflict).toBe("livenessReplace");
    }),
  );

  it.effect("layer + provide: last fragment wins per reference", () =>
    Effect.gen(function* () {
      const bundle = LookupPolicy.layer(
        LookupPolicy.sticky,
        LookupPolicy.unsticky,
        LookupPolicy.streamGap("drop"),
        LookupPolicy.streamGap("buffer"),
        LookupPolicy.verifyReject,
        LookupPolicy.verifyOff,
        LookupPolicy.askIncumbent,
        LookupPolicy.livenessReplace,
        LookupPolicy.yieldAccept,
        LookupPolicy.yieldRefuse,
      );
      const d = yield* readPolicy.pipe(Effect.provide(bundle));
      expect(d.sticky).toBe(false);
      expect(d.streamGap).toBe("buffer");
      expect(d.verify).toBe(false);
      expect(d.conflict).toBe("livenessReplace");
      expect(yield* d.yield).toBe(false);
    }),
  );

  it.effect("LookupPolicy.provide accepts a LookupPolicy.layer bundle + more fragments", () =>
    Effect.gen(function* () {
      const cutover = LookupPolicy.layer(LookupPolicy.unsticky, LookupPolicy.verifyOff);
      const d = yield* readPolicy.pipe(
        Effect.provide(
          LookupPolicy.layer(cutover, LookupPolicy.streamGap("drop"), LookupPolicy.coldAmbiguous("pickFirst")),
        ),
      );
      expect(d.sticky).toBe(false);
      expect(d.verify).toBe(false);
      expect(d.streamGap).toBe("drop");
      expect(d.cold).toBe("pickFirst");
    }),
  );

  it("resolveOnConflict + onConflictOf stay on Policy (Node re-exports same fn)", () => {
    expect(Node.resolveOnConflict).toBe(LookupPolicy.resolveOnConflict);
    expect(Lookup.resolveOnConflict).toBe(LookupPolicy.resolveOnConflict);
    class Worker extends Node.Service<Worker>()("policy-unit/stamp", {
      path: "/tmp/policy-unit-stamp.sock",
      onConflict: "reject",
    }) {}
    expect(LookupPolicy.onConflictOf(Worker)).toBe("reject");
    expect(LookupPolicy.onConflictOf({})).toBeUndefined();
  });
});

describe("Policy dial: unsticky + waitAdvice", () => {
  it.live("unsticky + pickFirst re-resolves when B joins (may leave A)", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("unsticky-lookup");
      const workerAPath = yield* tmpSock("unsticky-a");
      const workerBPath = yield* tmpSock("unsticky-b");

      const lookupNode = Node.Service()("policy-unit/unsticky-lookup", {
        path: lookupPath,
      }).pipe(Node.asLookup);

      class WorkerA extends Node.Service<WorkerA, Jobs>()("policy-unit/UnstickyA", {
        path: workerAPath,
      }) {}
      class WorkerB extends Node.Service<WorkerB, Jobs>()("policy-unit/UnstickyB", {
        path: workerBPath,
      }) {}

      const lookupClientLayer = Lookup.client(lookupNode);
      yield* Layer.build(Lookup.layerNode(lookupNode));
      const lookupCtx = yield* Layer.build(lookupClientLayer);

      yield* Layer.build(
        Node.unix(WorkerA, [
          Hyperlink.serve(Jobs, { jobs: Effect.succeed(5) }),
        ]).pipe(Layer.provide(lookupClientLayer)),
      );

      const clientCtx = yield* Layer.build(
        Hyperlink.lookupClient(Jobs).pipe(
          LookupPolicy.provide(LookupPolicy.unsticky, LookupPolicy.pick("first")),
          Layer.provide(lookupClientLayer),
        ),
      );

      const readJobs = Effect.gen(function* () {
        const jobs = yield* Jobs;
        return yield* jobs.jobs;
      }).pipe(Effect.provide(Context.merge(lookupCtx, clientCtx)));

      expect(yield* readJobs).toBe(5);

      yield* Layer.build(
        Node.unix(WorkerB, [
          Hyperlink.serve(Jobs, { jobs: Effect.succeed(9) }),
        ]).pipe(Layer.provide(lookupClientLayer)),
      );

      // Membership change + pickFirst — dial stays usable (5 or 9); not ambiguous.
      yield* Effect.sleep(Duration.millis(150));
      const n = yield* readJobs;
      expect(n === 5 || n === 9).toBe(true);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(30))),
  );

  it.live("waitAdvice: cold build waits for Advice.prefer", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("wait-lookup");
      const workerAPath = yield* tmpSock("wait-a");
      const workerBPath = yield* tmpSock("wait-b");

      const lookupNode = Node.Service()("policy-unit/wait-lookup", {
        path: lookupPath,
      }).pipe(Node.asLookup);

      class WorkerA extends Node.Service<WorkerA, Jobs>()("policy-unit/WaitA", {
        path: workerAPath,
      }) {}
      class WorkerB extends Node.Service<WorkerB, Jobs>()("policy-unit/WaitB", {
        path: workerBPath,
      }) {}

      const lookupClientLayer = Lookup.client(lookupNode);
      yield* Layer.build(Lookup.layerNode(lookupNode));
      const lookupCtx = yield* Layer.build(lookupClientLayer);

      yield* Layer.build(
        Node.unix(WorkerA, [
          Hyperlink.serve(Jobs, { jobs: Effect.succeed(5) }),
        ]).pipe(Layer.provide(lookupClientLayer)),
      );
      yield* Layer.build(
        Node.unix(WorkerB, [
          Hyperlink.serve(Jobs, { jobs: Effect.succeed(9) }),
        ]).pipe(Layer.provide(lookupClientLayer)),
      );

      const fiber = yield* Effect.forkChild(
        Layer.build(
          Hyperlink.lookupClient(Jobs).pipe(
            LookupPolicy.provide(LookupPolicy.coldAmbiguous("waitAdvice")),
            Layer.provide(lookupClientLayer),
          ),
        ),
      );

      yield* Effect.sleep(Duration.millis(80));
      // Still waiting — prefer B, then build completes.
      yield* Advice.prefer(Jobs, WorkerB.key).pipe(Effect.provide(lookupCtx));
      const clientCtx = yield* Fiber.join(fiber);

      const n = yield* Effect.gen(function* () {
        const jobs = yield* Jobs;
        return yield* jobs.jobs;
      }).pipe(Effect.provide(Context.merge(lookupCtx, clientCtx)));
      expect(n).toBe(9);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(30))),
  );
});

describe("Policy yield + conflict ambient", () => {
  it.effect("LookupPolicy.yieldRefuse on listen → askIncumbent newcomer gets IncumbentAlive", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("yield-refuse-lookup");
      const workerPath = yield* tmpSock("yield-refuse-worker");
      const lookupNode = Node.Service()("policy-unit/yield-refuse-lookup", {
        path: lookupPath,
        onConflict: "askIncumbent",
      }).pipe(Node.asLookup);

      class Worker extends Node.Service<Worker, Jobs>()(
        "policy-unit/YieldRefuseWorker",
        { path: workerPath },
      ) {}

      const lookupServer = yield* Layer.build(Lookup.layerNode(lookupNode));
      const lookupClient = yield* Layer.build(Lookup.client(lookupNode));
      const lookupCtx = Context.merge(lookupServer, lookupClient);

      const workerCtx = yield* Layer.build(
        Node.unix(Worker, [Hyperlink.serve(Jobs, jobsImpl)]).pipe(
          LookupPolicy.provide(LookupPolicy.yieldRefuse),
          Layer.provide(Lookup.client(lookupNode)),
        ),
      );

      const dir = Context.get(lookupCtx, Directory.Service);
      const conflict = yield* dir
        .advertise(
          new Lookup.AdvertiseRequest({
            nodeKey: Worker.key,
            kind: "IpcSocket",
            path: "/tmp/policy-unit-yield-refused.sock",
            serves: [Jobs.key],
            onConflict: "inherit",
          }),
        )
        .pipe(
          Effect.map((entry) => ({ _tag: "ok" as const, entry })),
          Effect.catchTag("IncumbentAlive", (error) =>
            Effect.succeed({ _tag: "alive" as const, error }),
          ),
          Effect.provide(lookupCtx),
        );

      expect(conflict._tag).toBe("alive");
      yield* Effect.sync(() => {
        void workerCtx;
      });
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
  );

  it.effect("LookupPolicy.askIncumbent ambient on advertise (call-site inherit)", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("ambient-ask-lookup");
      const workerPath = yield* tmpSock("ambient-ask-worker");
      // Lookup stamp askIncumbent so server finishes cooperatively.
      const lookupNode = Node.Service()("policy-unit/ambient-ask-lookup", {
        path: lookupPath,
        onConflict: "askIncumbent",
      }).pipe(Node.asLookup);

      class Worker extends Node.Service<Worker, Jobs>()(
        "policy-unit/AmbientAskWorker",
        { path: workerPath },
      ) {}

      const lookupServer = yield* Layer.build(Lookup.layerNode(lookupNode));
      const lookupClient = yield* Layer.build(Lookup.client(lookupNode));
      const lookupCtx = Context.merge(lookupServer, lookupClient);

      // Incumbent accepts yield (default). Ambient askIncumbent on first listen.
      yield* Layer.build(
        Node.unix(Worker, [Hyperlink.serve(Jobs, jobsImpl)]).pipe(
          LookupPolicy.provide(LookupPolicy.askIncumbent, LookupPolicy.yieldAccept),
          Layer.provide(Lookup.client(lookupNode)),
        ),
      );

      const dir = Context.get(lookupCtx, Directory.Service);
      const rows = yield* dir.nodesServing(
        new Lookup.NodesServingRequest({ serviceKey: Jobs.key }),
      );
      expect(rows.length).toBe(1);

      // Newcomer with different dial + inherit — Lookup asks incumbent; accept → replace.
      const replaced = yield* dir
        .advertise(
          new Lookup.AdvertiseRequest({
            nodeKey: Worker.key,
            kind: "IpcSocket",
            path: "/tmp/policy-unit-ambient-newcomer.sock",
            serves: [Jobs.key],
            onConflict: "inherit",
          }),
        )
        .pipe(Effect.provide(lookupCtx));
      expect(replaced.path).toBe("/tmp/policy-unit-ambient-newcomer.sock");
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
  );
});

describe("LookupPolicy.verifyOff on addressed client", () => {
  it.live("dead peer + verifyOff builds; verifyReject fails", () =>
    Effect.gen(function* () {
      class Ghost extends Node.Service<Ghost>()("policy-unit/Ghost", {
        path: `/tmp/policy-unit-ghost-${process.pid}.sock`,
      }) {}

      const offExit = yield* Effect.exit(
        Layer.build(
          Hyperlink.client(Jobs, Ghost).pipe(LookupPolicy.provide(LookupPolicy.verifyOff)),
        ),
      );
      expect(offExit._tag).toBe("Success");

      const rejectExit = yield* Effect.exit(
        Layer.build(
          Hyperlink.client(Jobs, Ghost).pipe(
            LookupPolicy.provide(LookupPolicy.verifyReject),
          ),
        ),
      );
      expectTaggedFailure(rejectExit, "NodeUnreachable");
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
  );
});

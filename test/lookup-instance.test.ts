import { Clock, Context, Duration, Effect, Layer, Schema } from "effect";
import { describe, it } from "@effect/vitest";
import { expect } from "vitest";
import { combineQuery, combineSum } from "../src/MultiNode";
import * as Lookup from "../src/Lookup";
import * as Resource from "../src/Resource";
import * as Node from "../src/Node";
import { expectTaggedFailure } from "./fixtures/expectTaggedFailure";

// Dynamic Node.Prototype.instance — many prototypeKey#suffix; ephemeral ipc; no claim.

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/effect-pm-inst-${label}-${process.pid}-${now}.sock`;
  });

class Jobs extends Resource.Tag<Jobs>()("inst/Jobs", {
  jobs: Resource.effect(Schema.Number),
}).pipe(Resource.distributed) {}

const jobsImpl = (n: number) => ({ jobs: Effect.succeed(n) });

describe("Node.Prototype.instance / .listen", () => {
  it("stamps isDynamicInstance and optional #suffix wire key", () => {
    class MailWorker extends Node.Prototype<MailWorker, Jobs>(
      "inst/MailWorker",
    ) {}
    const auto = MailWorker.instance();
    expect(auto.isDynamicInstance).toBe(true);
    expect(auto.dynamicPrototypeKey).toBe("inst/MailWorker");
    expect(auto.key).toBe("inst/MailWorker");
    expect(auto.path).toBeUndefined();

    const named = MailWorker.instance("w1");
    expect(named.key).toBe("inst/MailWorker#w1");
    expect(named.instanceSuffix).toBe("w1");
    expect(MailWorker.isPrototype).toBe(true);
  });

  it.effect("Prototype.listen curries serves; ListenNode is in built context", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("proto-listen");
      const lookupNode = Node.Lookup("inst/proto-listen", {
        path: lookupPath,
      });
      class MailWorker extends Node.Prototype<MailWorker, Jobs>(
        "inst/CurryWorker",
      ) {}
      const lookupClient = Lookup.client(lookupNode);
      yield* Layer.build(Lookup.layer(lookupNode));

      const mailWorker = MailWorker.listen(
        [Resource.serve(Jobs, jobsImpl(9))],
        { bootstrapLookup: false },
      );
      const ctx = yield* Layer.build(
        mailWorker("w2").pipe(Layer.provide(lookupClient)),
      );
      const node = Context.get(ctx, Node.ListenNode);
      expect(node.key).toBe("inst/CurryWorker#w2");
      expect(node.path).toBeDefined();
      expect(node.kind).toBe("IpcSocket");

      const n = yield* Effect.gen(function* () {
        const jobs = yield* Jobs;
        return yield* jobs.jobs;
      }).pipe(Effect.provide(ctx));
      expect(n).toBe(9);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
  );

  it.effect("listen mints path + suffix, advertises, and serves without claim", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("lookup");
      const lookupNode = Node.Lookup("inst/lookup", {
        path: lookupPath,
      });
      class MailWorker extends Node.Prototype<MailWorker, Jobs>(
        "inst/WorkerA",
      ) {}

      const lookupClient = Lookup.client(lookupNode);
      const lookupServer = yield* Layer.build(Lookup.layer(lookupNode));
      const lookupCtx = yield* Layer.build(lookupClient);
      const lookup = Context.merge(lookupServer, lookupCtx);

      const worker = MailWorker.listen(
        [Resource.serve(Jobs, jobsImpl(3))],
        { bootstrapLookup: false },
      )
      // second factory with different impl — same Prototype, own curry
      const workerB = MailWorker.listen(
        [Resource.serve(Jobs, jobsImpl(5))],
        { bootstrapLookup: false },
      )
      const a = yield* Layer.build(
        worker().pipe(Layer.provide(lookupClient)),
      );
      const b = yield* Layer.build(
        workerB().pipe(Layer.provide(lookupClient)),
      );

      const dir = Context.get(lookup, Lookup.Directory);
      const rows = yield* dir
        .nodesServing(
          new Lookup.NodesServingRequest({ resourceKey: "inst/Jobs" }),
        )
        .pipe(Effect.provide(lookup));
      expect(rows.length).toBe(2);
      for (const row of rows) {
        expect(row.nodeKey.startsWith("inst/WorkerA#")).toBe(true);
        expect(row.kind).toBe("IpcSocket");
        expect(row.path).toBeDefined();
      }
      expect(new Set(rows.map((r) => r.nodeKey)).size).toBe(2);

      // Bare lookupClient stays fail-closed when many instances serve the Tag.
      const exit = yield* Effect.exit(
        Layer.build(
          Resource.lookupClient(Jobs).pipe(Layer.provide(lookupClient)),
        ).pipe(Effect.scoped),
      );
      expectTaggedFailure(exit, "LookupClientError");

      // D4 — opt-in pick dials one replica.
      const soft = yield* Layer.build(
        Resource.lookupClient(Jobs, { pick: "first" }).pipe(
          Layer.provide(lookupClient),
        ),
      );
      const n = yield* Effect.gen(function* () {
        const jobs = yield* Jobs;
        return yield* jobs.jobs;
      }).pipe(
        Effect.provide(
          Context.merge(lookup, Context.merge(a, Context.merge(b, soft))),
        ),
      );
      expect([3, 5]).toContain(n);

      // Custom picker selects the Jobs=5 worker by ListenNode key.
      const nodeB = Context.get(b, Node.ListenNode);
      const softB = yield* Layer.build(
        Resource.lookupClient(Jobs, {
          pick: (rows) =>
            rows.find((r) => r.nodeKey === nodeB.key) ?? rows[0]!,
        }).pipe(Layer.provide(lookupClient)),
      );
      const nB = yield* Effect.gen(function* () {
        const jobs = yield* Jobs;
        return yield* jobs.jobs;
      }).pipe(
        Effect.provide(
          Context.merge(lookup, Context.merge(a, Context.merge(b, softB))),
        ),
      );
      expect(nB).toBe(5);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(25))),
  );

  it.effect("named instance suffix is stable; peersLayer folds both via directory", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("peers-lookup");
      const lookupNode = Node.Lookup("inst/peers-lookup", {
        path: lookupPath,
      });
      class FleetJobs extends Resource.Tag<FleetJobs>()("inst/FleetJobs", {
        jobs: Resource.effect(Schema.Number),
        fleetJobs: Resource.effect(Schema.Number).pipe(Resource.fleet),
      }).pipe(Resource.distributed) {}

      class PoolWorker extends Node.Prototype<PoolWorker, FleetJobs>(
        "inst/PoolWorker",
      ) {}

      const fleetImpl = (own: number) =>
        Effect.gen(function* () {
          const peers = yield* Resource.peers(FleetJobs);
          return {
            jobs: Effect.succeed(own),
            fleetJobs: combineQuery(peers, (p) => p.jobs, combineSum).pipe(
              Effect.map((others) => own + others),
            ),
          };
        });

      const lookupClient = Lookup.client(lookupNode);
      const lookupServer = yield* Layer.build(Lookup.layer(lookupNode));
      const lookupCtx = yield* Layer.build(lookupClient);
      const lookup = Context.merge(lookupServer, lookupCtx);

      const east = PoolWorker.instance("east");
      const westLive = PoolWorker.listen(
        [
          Resource.serve(FleetJobs, fleetImpl(5)).pipe(
            Layer.provide(Resource.peersFrom(FleetJobs, {})),
          ),
        ],
        { bootstrapLookup: false },
      );
      const eastLive = PoolWorker.listen(
        [
          Resource.serve(FleetJobs, fleetImpl(2)).pipe(
            Layer.provide(Resource.peersLayer(FleetJobs, east)),
          ),
        ],
        { bootstrapLookup: false },
      );

      const westCtx = yield* Layer.build(
        westLive("west").pipe(Layer.provide(lookupClient)),
      );

      const peersCtx = yield* Layer.build(
        Resource.peersLayer(FleetJobs, east).pipe(
          Layer.provide(lookupClient),
        ),
      );
      const peerKeys = Object.keys(
        yield* Resource.peers(FleetJobs).pipe(Effect.provide(peersCtx)),
      );
      expect(peerKeys).toContain("inst/PoolWorker#west");
      expect(peerKeys).not.toContain("inst/PoolWorker#east");

      const eastCtx = yield* Layer.build(
        eastLive("east").pipe(Layer.provide(lookupClient)),
      );

      // instance() is address-less until listen — dial the advertised path.
      const dir = Context.get(lookup, Lookup.Directory);
      const rows = yield* dir
        .nodesServing(
          new Lookup.NodesServingRequest({
            resourceKey: "inst/FleetJobs",
          }),
        )
        .pipe(Effect.provide(lookup));
      const eastRow = rows.find((r) => r.nodeKey === east.key);
      expect(eastRow?.path).toBeDefined();
      const dialEast = Node.Tag(east.key, {
        path: eastRow?.path as string,
      });

      const total = yield* Effect.gen(function* () {
        const jobs = yield* FleetJobs;
        expect(yield* jobs.jobs).toBe(2);
        return yield* jobs.fleetJobs;
      }).pipe(
        Effect.provide(Resource.client(FleetJobs, dialEast)),
        Effect.scoped,
      );
      expect(total).toBe(7);

      yield* Effect.sync(() => {
        void westCtx;
        void eastCtx;
        void peersCtx;
      });
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(25))),
  );
});

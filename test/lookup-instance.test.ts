import { Clock, Context, Duration, Effect, Exit, Layer, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { combineQuery, combineSum } from "../src/MultiNode";
import * as Lookup from "../src/Lookup";
import * as Resource from "../src/Resource";

// Dynamic Prototype.instance — many prototypeKey#suffix; ephemeral ipc; no claim.

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/effect-pm-inst-${label}-${process.pid}-${now}.sock`;
  });

class Jobs extends Resource.Tag<Jobs>()("inst/Jobs", {
  jobs: Resource.effect(Schema.Number),
}).pipe(Resource.distributed) {}

const jobsImpl = (n: number) => ({ jobs: Effect.succeed(n) });

describe("Resource.Prototype.instance", () => {
  it("stamps isDynamicInstance and optional #suffix wire key", () => {
    class MailWorker extends Resource.Prototype<MailWorker, Jobs>(
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

  it("listen mints path + suffix, advertises, and serves without claim", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const lookupPath = yield* tmpSock("lookup");
        const lookupNode = Lookup.LookupNode("inst/lookup", {
          path: lookupPath,
        });
        class MailWorker extends Resource.Prototype<MailWorker, Jobs>(
          "inst/WorkerA",
        ) {}

        const lookupClient = Lookup.client(lookupNode);
        const lookupServer = yield* Layer.build(Lookup.layer(lookupNode));
        const lookupCtx = yield* Layer.build(lookupClient);
        const lookup = Context.merge(lookupServer, lookupCtx);

        const a = yield* Layer.build(
          Resource.listen(MailWorker.instance(), [
            Resource.serve(Jobs, jobsImpl(3)),
          ]).pipe(Layer.provide(lookupClient)),
        );
        const b = yield* Layer.build(
          Resource.listen(MailWorker.instance(), [
            Resource.serve(Jobs, jobsImpl(5)),
          ]).pipe(Layer.provide(lookupClient)),
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

        // lookupClient stays fail-closed when many instances serve the Tag (D4).
        const exit = yield* Effect.exit(
          Layer.build(
            Resource.lookupClient(Jobs).pipe(Layer.provide(lookupClient)),
          ).pipe(Effect.scoped),
        );
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          expect(String(exit.cause)).toContain("LookupClientError");
        }

        yield* Effect.sync(() => {
          void a;
          void b;
        });
      }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(25))),
    ));

  it("named instance suffix is stable; peersLayer folds both via directory", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const lookupPath = yield* tmpSock("peers-lookup");
        const lookupNode = Lookup.LookupNode("inst/peers-lookup", {
          path: lookupPath,
        });
        class FleetJobs extends Resource.Tag<FleetJobs>()("inst/FleetJobs", {
          jobs: Resource.effect(Schema.Number),
          fleetJobs: Resource.effect(Schema.Number).pipe(Resource.fleet),
        }).pipe(Resource.distributed) {}

        class PoolWorker extends Resource.Prototype<PoolWorker, FleetJobs>(
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

        const west = PoolWorker.instance("west");
        const east = PoolWorker.instance("east");

        const westCtx = yield* Layer.build(
          Resource.listen(west, [
            Resource.serve(FleetJobs, fleetImpl(5)).pipe(
              Layer.provide(Resource.peersFrom(FleetJobs, {})),
            ),
          ]).pipe(Layer.provide(lookupClient)),
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
          Resource.listen(east, [
            Resource.serve(FleetJobs, fleetImpl(2)).pipe(
              Layer.provide(Resource.peersLayer(FleetJobs, east)),
            ),
          ]).pipe(Layer.provide(lookupClient)),
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
        const dialEast = Resource.Node(east.key, {
          path: eastRow?.path as string,
        });

        const total = yield* Effect.gen(function* () {
          const jobs = yield* FleetJobs;
          expect(yield* jobs.jobs).toBe(2);
          return yield* jobs.fleetJobs;
        }).pipe(
          Effect.provide(
            Resource.client(FleetJobs, dialEast).pipe(
              Layer.provide(Resource.connect(dialEast)),
            ),
          ),
          Effect.scoped,
        );
        expect(total).toBe(7);

        yield* Effect.sync(() => {
          void westCtx;
          void eastCtx;
          void peersCtx;
        });
      }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(25))),
    ));
});

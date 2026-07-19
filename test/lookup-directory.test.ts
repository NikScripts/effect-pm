import { Clock, Context, Duration, Effect, Layer, Schema } from "effect";
import { describe, expect, it } from "vitest";
import * as Lookup from "../src/Lookup";
import * as Resource from "../src/Resource";

// D5/D6 — node directory on Lookup: advertise / nodesServing / unregister / livenessReplace.

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/effect-pm-lookup-dir-${label}-${process.pid}-${now}.sock`;
  });

const withLookup = <A, E>(
  server: Layer.Layer<never>,
  client: Layer.Layer<Lookup.Identity | Lookup.Directory>,
  use: Effect.Effect<A, E, Lookup.Identity | Lookup.Directory>,
) =>
  Effect.gen(function* () {
    const serverCtx = yield* Layer.build(server);
    const clientCtx = yield* Layer.build(client);
    return yield* use.pipe(
      Effect.provide(Context.merge(serverCtx, clientCtx)),
    );
  }).pipe(Effect.scoped);

class Jobs extends Resource.Tag<Jobs>()("lookup-dir/Jobs", {
  jobs: Resource.effect(Schema.Number),
}) {}

const jobsImpl = { jobs: Effect.succeed(1) };

describe("Lookup directory advertise / nodesServing", () => {
  it("advertise stores serves[]; nodesServing filters by resource key", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const path = yield* tmpSock("adv");
        const node = Lookup.LookupNode("lookup/dir-adv", { path });

        yield* withLookup(
          Lookup.layer(node),
          Lookup.client(node),
          Effect.gen(function* () {
            const dir = yield* Lookup.Directory;
            const entry = yield* dir.advertise(
              new Lookup.AdvertiseRequest({
                nodeKey: "worker-a",
                kind: "IpcSocket",
                path: "/tmp/worker-a.sock",
                serves: ["lookup-dir/Jobs", "lookup-dir/Emails"],
              }),
            );
            expect(entry.nodeKey).toBe("worker-a");
            expect(entry.serves).toEqual([
              "lookup-dir/Jobs",
              "lookup-dir/Emails",
            ]);

            const hit = yield* dir.nodesServing(
              new Lookup.NodesServingRequest({
                resourceKey: "lookup-dir/Jobs",
              }),
            );
            expect(hit).toHaveLength(1);
            expect(hit[0]?.nodeKey).toBe("worker-a");

            const miss = yield* dir.nodesServing(
              new Lookup.NodesServingRequest({
                resourceKey: "lookup-dir/Other",
              }),
            );
            expect(miss).toHaveLength(0);
          }),
        );
      }).pipe(Effect.timeout(Duration.seconds(15))),
    ));

  it("unregister removes the row", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const path = yield* tmpSock("unreg");
        const node = Lookup.LookupNode("lookup/dir-unreg", { path });

        yield* withLookup(
          Lookup.layer(node),
          Lookup.client(node),
          Effect.gen(function* () {
            const dir = yield* Lookup.Directory;
            yield* dir.advertise(
              new Lookup.AdvertiseRequest({
                nodeKey: "worker-a",
                kind: "IpcSocket",
                path: "/tmp/worker-a.sock",
                serves: ["lookup-dir/Jobs"],
              }),
            );
            const removed = yield* dir.unregister(
              new Lookup.UnregisterRequest({ nodeKey: "worker-a" }),
            );
            expect(removed).toBe(true);
            const again = yield* dir.unregister(
              new Lookup.UnregisterRequest({ nodeKey: "worker-a" }),
            );
            expect(again).toBe(false);
            const hit = yield* dir.nodesServing(
              new Lookup.NodesServingRequest({
                resourceKey: "lookup-dir/Jobs",
              }),
            );
            expect(hit).toHaveLength(0);
          }),
        );
      }).pipe(Effect.timeout(Duration.seconds(15))),
    ));

  it("same dial target refreshes serves without IncumbentAlive", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const path = yield* tmpSock("refresh");
        const node = Lookup.LookupNode("lookup/dir-refresh", { path });

        yield* withLookup(
          Lookup.layer(node),
          Lookup.client(node),
          Effect.gen(function* () {
            const dir = yield* Lookup.Directory;
            yield* dir.advertise(
              new Lookup.AdvertiseRequest({
                nodeKey: "worker-a",
                kind: "IpcSocket",
                path: "/tmp/worker-a.sock",
                serves: ["lookup-dir/Jobs"],
              }),
            );
            const refreshed = yield* dir.advertise(
              new Lookup.AdvertiseRequest({
                nodeKey: "worker-a",
                kind: "IpcSocket",
                path: "/tmp/worker-a.sock",
                serves: ["lookup-dir/Jobs", "lookup-dir/Emails"],
              }),
            );
            expect(refreshed.serves).toEqual([
              "lookup-dir/Jobs",
              "lookup-dir/Emails",
            ]);
          }),
        );
      }).pipe(Effect.timeout(Duration.seconds(15))),
    ));
});

describe("Lookup directory livenessReplace", () => {
  it("alive incumbent rejects a different dial target", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const lookupPath = yield* tmpSock("live-lookup");
        const workerPath = yield* tmpSock("live-worker");
        const lookupNode = Lookup.LookupNode("lookup/dir-live", {
          path: lookupPath,
        });

        class Worker extends Resource.Node<Worker, Jobs>("lookup-dir/Worker", {
          path: workerPath,
        }) {}

        const lookupServer = yield* Layer.build(Lookup.layer(lookupNode));
        const lookupClient = yield* Layer.build(Lookup.client(lookupNode));
        const lookupCtx = Context.merge(lookupServer, lookupClient);

        // listen advertises when Directory is provided
        const workerCtx = yield* Layer.build(
          Resource.listen(Worker, [Resource.serve(Jobs, jobsImpl)]).pipe(
            Layer.provide(Lookup.client(lookupNode)),
          ),
        );

        const dir = Context.get(lookupCtx, Lookup.Directory);
        const listed = yield* dir
          .nodesServing(
            new Lookup.NodesServingRequest({
              resourceKey: "lookup-dir/Jobs",
            }),
          )
          .pipe(Effect.provide(lookupCtx));
        expect(listed).toHaveLength(1);
        expect(listed[0]?.path).toBe(workerPath);
        expect(listed[0]?.serves).toContain("lookup-dir/Jobs");

        const conflict = yield* dir
          .advertise(
            new Lookup.AdvertiseRequest({
              nodeKey: Worker.key,
              kind: "IpcSocket",
              path: "/tmp/other-worker.sock",
              serves: ["lookup-dir/Jobs"],
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
        if (conflict._tag === "alive") {
          expect(conflict.error.nodeKey).toBe(Worker.key);
          expect(conflict.error.incumbent.path).toBe(workerPath);
        }

        // keep contexts alive until assertions finish
        yield* Effect.sync(() => workerCtx);
      }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
    ));

  it("dead / unreachable incumbent is replaced", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const path = yield* tmpSock("dead");
        const node = Lookup.LookupNode("lookup/dir-dead", { path });

        yield* withLookup(
          Lookup.layer(node),
          Lookup.client(node),
          Effect.gen(function* () {
            const dir = yield* Lookup.Directory;
            // Stale row — no process on this sock
            yield* dir.advertise(
              new Lookup.AdvertiseRequest({
                nodeKey: "worker-stale",
                kind: "IpcSocket",
                path: `/tmp/effect-pm-lookup-dir-missing-${process.pid}.sock`,
                serves: ["lookup-dir/Jobs"],
              }),
            );

            const replaced = yield* dir.advertise(
              new Lookup.AdvertiseRequest({
                nodeKey: "worker-stale",
                kind: "IpcSocket",
                path: "/tmp/worker-fresh.sock",
                serves: ["lookup-dir/Jobs"],
              }),
            );
            expect(replaced.path).toBe("/tmp/worker-fresh.sock");
          }),
        );
      }).pipe(Effect.timeout(Duration.seconds(20))),
    ));
});

describe("Resource.listen directory wire", () => {
  it("unregisters the directory row when the listen scope closes", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const lookupPath = yield* tmpSock("close-lookup");
        const workerPath = yield* tmpSock("close-worker");
        const lookupNode = Lookup.LookupNode("lookup/dir-close", {
          path: lookupPath,
        });

        class Worker extends Resource.Node<Worker, Jobs>("lookup-dir/CloseWorker", {
          path: workerPath,
        }) {}

        const lookupServer = yield* Layer.build(Lookup.layer(lookupNode));
        const lookupClient = yield* Layer.build(Lookup.client(lookupNode));
        const lookupCtx = Context.merge(lookupServer, lookupClient);

        yield* Effect.gen(function* () {
          yield* Layer.build(
            Resource.listen(Worker, [Resource.serve(Jobs, jobsImpl)]).pipe(
              Layer.provide(Lookup.client(lookupNode)),
            ),
          );
          const dir = Context.get(lookupCtx, Lookup.Directory);
          const during = yield* dir
            .nodesServing(
              new Lookup.NodesServingRequest({
                resourceKey: "lookup-dir/Jobs",
              }),
            )
            .pipe(Effect.provide(lookupCtx));
          expect(during).toHaveLength(1);
        }).pipe(Effect.scoped);

        const dir = Context.get(lookupCtx, Lookup.Directory);
        const after = yield* dir
          .nodesServing(
            new Lookup.NodesServingRequest({
              resourceKey: "lookup-dir/Jobs",
            }),
          )
          .pipe(Effect.provide(lookupCtx));
        expect(after).toHaveLength(0);
      }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
    ));
});

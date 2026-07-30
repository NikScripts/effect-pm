import {
  Clock,
  Context,
  Duration,
  Effect,
  Layer,
  Option,
  Ref,
  Schedule,
  Schema,
  Stream,
  type Scope,
} from "effect";
import { describe, it } from "@effect/vitest";
import { expect } from "vitest";
import * as Lookup from "../src/Lookup";
import * as Directory from "../src/Directory";
import * as Hyperlink from "../src/Hyperlink";
import * as Policy from "../src/Policy";
import * as Node from "../src/Node";

// D5/D6 — node directory on Lookup: advertise / nodesServing / unregister / livenessReplace.

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/hyperlink-ts-lookup-dir-${label}-${process.pid}-${now}.sock`;
  });

const withLookup = <A, E>(
  server: Layer.Layer<never, Lookup.LookupUnaddressed>,
  client: Layer.Layer<Lookup.Services, Lookup.LookupUnaddressed>,
  use: Effect.Effect<A, E, Lookup.Services | Scope.Scope>,
) =>
  Effect.gen(function* () {
    const serverCtx = yield* Layer.build(server);
    const clientCtx = yield* Layer.build(client);
    return yield* use.pipe(
      Effect.provide(Context.merge(serverCtx, clientCtx)),
    );
  }).pipe(Effect.scoped);

class Jobs extends Hyperlink.Tag<Jobs>()("lookup-dir/Jobs", {
  jobs: Hyperlink.effect(Schema.Number),
}) {}

const jobsImpl = { jobs: Effect.succeed(1) };

describe("Lookup directory advertise / nodesServing", () => {
  it.effect("advertise stores serves[]; nodesServing filters by resource key", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("adv");
      const node = Node.Tag()("lookup/dir-adv", { path }).pipe(Node.asLookup);

      yield* withLookup(
        Lookup.layerNode(node),
        Lookup.client(node),
        Effect.gen(function* () {
          const dir = yield* Directory.Tag;
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
              serviceKey: "lookup-dir/Jobs",
            }),
          );
          expect(hit).toHaveLength(1);
          expect(hit[0]?.nodeKey).toBe("worker-a");

          // Module sugar — Tag or wire key (same Directory query).
          const viaSugar = yield* Lookup.nodesServing(Jobs);
          expect(viaSugar).toHaveLength(1);
          expect(viaSugar[0]?.nodeKey).toBe("worker-a");

          const miss = yield* dir.nodesServing(
            new Lookup.NodesServingRequest({
              serviceKey: "lookup-dir/Other",
            }),
          );
          expect(miss).toHaveLength(0);
        }),
      );
    }).pipe(Effect.timeout(Duration.seconds(15))),
  );

  it.effect("unregister removes the row", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("unreg");
      const node = Node.Tag()("lookup/dir-unreg", { path }).pipe(Node.asLookup);

      yield* withLookup(
        Lookup.layerNode(node),
        Lookup.client(node),
        Effect.gen(function* () {
          const dir = yield* Directory.Tag;
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
              serviceKey: "lookup-dir/Jobs",
            }),
          );
          expect(hit).toHaveLength(0);
        }),
      );
    }).pipe(Effect.timeout(Duration.seconds(15))),
  );

  it.effect("same dial target refreshes serves without IncumbentAlive", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("refresh");
      const node = Node.Tag()("lookup/dir-refresh", { path }).pipe(Node.asLookup);

      yield* withLookup(
        Lookup.layerNode(node),
        Lookup.client(node),
        Effect.gen(function* () {
          const dir = yield* Directory.Tag;
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
  );
});

describe("Lookup directory livenessReplace", () => {
  it.effect("alive incumbent rejects a different dial target", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("live-lookup");
      const workerPath = yield* tmpSock("live-worker");
      const lookupNode = Node.Tag()("lookup/dir-live", {
        path: lookupPath,
      }).pipe(Node.asLookup);

      class Worker extends Node.Tag<Worker, Jobs>()("lookup-dir/Worker", {
        path: workerPath,
      }) {}

      const lookupServer = yield* Layer.build(Lookup.layerNode(lookupNode));
      const lookupClient = yield* Layer.build(Lookup.client(lookupNode));
      const lookupCtx = Context.merge(lookupServer, lookupClient);

      // listen advertises when Directory is provided
      const workerCtx = yield* Layer.build(
        Node.unix(Worker, [Hyperlink.serve(Jobs, jobsImpl)]).pipe(Layer.provide(Lookup.client(lookupNode))),
      );

      const dir = Context.get(lookupCtx, Directory.Tag);
      const listed = yield* dir
        .nodesServing(
          new Lookup.NodesServingRequest({
            serviceKey: "lookup-dir/Jobs",
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
  );

  // Probe of a missing sock uses Effect.timeout(2s) — needs a live clock.
  it.live("dead / unreachable incumbent is replaced", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("dead");
      const node = Node.Tag()("lookup/dir-dead", { path }).pipe(Node.asLookup);

      yield* withLookup(
        Lookup.layerNode(node),
        Lookup.client(node),
        Effect.gen(function* () {
          const dir = yield* Directory.Tag;
          // Stale row — no process on this sock
          yield* dir.advertise(
            new Lookup.AdvertiseRequest({
              nodeKey: "worker-stale",
              kind: "IpcSocket",
              path: `/tmp/hyperlink-ts-lookup-dir-missing-${process.pid}.sock`,
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
  );
});

describe("Node.unix directory wire", () => {
  it.effect("unregisters the directory row when the unix scope closes", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("close-lookup");
      const workerPath = yield* tmpSock("close-worker");
      const lookupNode = Node.Tag()("lookup/dir-close", {
        path: lookupPath,
      }).pipe(Node.asLookup);

      class Worker extends Node.Tag<Worker, Jobs>()("lookup-dir/CloseWorker", {
        path: workerPath,
      }) {}

      const lookupServer = yield* Layer.build(Lookup.layerNode(lookupNode));
      const lookupClient = yield* Layer.build(Lookup.client(lookupNode));
      const lookupCtx = Context.merge(lookupServer, lookupClient);

      yield* Effect.gen(function* () {
        yield* Layer.build(
        Node.unix(Worker, [Hyperlink.serve(Jobs, jobsImpl)]).pipe(Layer.provide(Lookup.client(lookupNode))),
        );
        const dir = Context.get(lookupCtx, Directory.Tag);
        const during = yield* dir
          .nodesServing(
            new Lookup.NodesServingRequest({
              serviceKey: "lookup-dir/Jobs",
            }),
          )
          .pipe(Effect.provide(lookupCtx));
        expect(during).toHaveLength(1);
      }).pipe(Effect.scoped);

      const dir = Context.get(lookupCtx, Directory.Tag);
      const after = yield* dir
        .nodesServing(
          new Lookup.NodesServingRequest({
            serviceKey: "lookup-dir/Jobs",
          }),
        )
        .pipe(Effect.provide(lookupCtx));
      expect(after).toHaveLength(0);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
  );
});

describe("resolveOnConflict", () => {
  it("walks prefs until a concrete policy; hard fallback livenessReplace", () => {
    expect(Policy.resolveOnConflict("inherit", "askIncumbent")).toBe(
      "askIncumbent",
    );
    expect(Policy.resolveOnConflict(undefined, "inherit", "reject")).toBe(
      "reject",
    );
    expect(Policy.resolveOnConflict("livenessReplace", "askIncumbent")).toBe(
      "livenessReplace",
    );
    expect(Policy.resolveOnConflict("inherit", undefined)).toBe(
      "livenessReplace",
    );
    expect(Node.resolveOnConflict).toBe(Policy.resolveOnConflict);
  });

  it("Lookup stamps concrete default; Tag defaults inherit", () => {
    const lookup = Node.Tag()("lookup/policy-default", {
      path: "/tmp/lookup-policy.sock",
    }).pipe(Node.asLookup);
    const worker = Node.Tag()("lookup/policy-worker", {
      path: "/tmp/worker-policy.sock",
    });
    expect(lookup.onConflict).toBe("livenessReplace");
    expect(worker.onConflict).toBe("inherit");

    const askLookup = Node.Tag()("lookup/policy-ask", {
      path: "/tmp/lookup-ask.sock",
      onConflict: "askIncumbent",
    }).pipe(Node.asLookup);
    expect(askLookup.onConflict).toBe("askIncumbent");
  });
});

describe("Lookup directory askIncumbent", () => {
  it.effect("alive incumbent yields → newcomer replaces the row", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("ask-lookup");
      const workerPath = yield* tmpSock("ask-worker");
      const lookupNode = Node.Tag()("lookup/dir-ask", {
        path: lookupPath,
        onConflict: "askIncumbent",
      }).pipe(Node.asLookup);

      class Worker extends Node.Tag<Worker, Jobs>()("lookup-dir/AskWorker", {
        path: workerPath,
      }) {}

      const lookupServer = yield* Layer.build(Lookup.layerNode(lookupNode));
      const lookupClient = yield* Layer.build(Lookup.client(lookupNode));
      const lookupCtx = Context.merge(lookupServer, lookupClient);

      const workerCtx = yield* Layer.build(
        Node.unix(Worker, [Hyperlink.serve(Jobs, jobsImpl)]).pipe(Layer.provide(Lookup.client(lookupNode))),
      );

      const dir = Context.get(lookupCtx, Directory.Tag);
      const replaced = yield* dir
        .advertise(
          new Lookup.AdvertiseRequest({
            nodeKey: Worker.key,
            kind: "IpcSocket",
            path: "/tmp/ask-newcomer.sock",
            serves: ["lookup-dir/Jobs"],
            onConflict: "inherit",
          }),
        )
        .pipe(Effect.provide(lookupCtx));

      expect(replaced.path).toBe("/tmp/ask-newcomer.sock");

      // Late incumbent unregister (dial-matched) must not wipe the newcomer.
      const removed = yield* dir
        .unregister(
          new Lookup.UnregisterRequest({
            nodeKey: Worker.key,
            kind: "IpcSocket",
            path: workerPath,
          }),
        )
        .pipe(Effect.provide(lookupCtx));
      expect(removed).toBe(false);

      const listed = yield* dir
        .nodesServing(
          new Lookup.NodesServingRequest({
            serviceKey: "lookup-dir/Jobs",
          }),
        )
        .pipe(Effect.provide(lookupCtx));
      expect(listed).toHaveLength(1);
      expect(listed[0]?.path).toBe("/tmp/ask-newcomer.sock");

      yield* Effect.sync(() => workerCtx);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
  );

  it.effect("call-site livenessReplace wins over Lookup askIncumbent", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("ask-override-lookup");
      const workerPath = yield* tmpSock("ask-override-worker");
      const lookupNode = Node.Tag()("lookup/dir-ask-override", {
        path: lookupPath,
        onConflict: "askIncumbent",
      }).pipe(Node.asLookup);

      class Worker extends Node.Tag<Worker, Jobs>()(
        "lookup-dir/AskOverrideWorker",
        { path: workerPath },
      ) {}

      const lookupServer = yield* Layer.build(Lookup.layerNode(lookupNode));
      const lookupClient = yield* Layer.build(Lookup.client(lookupNode));
      const lookupCtx = Context.merge(lookupServer, lookupClient);

      const workerCtx = yield* Layer.build(
        Node.unix(Worker, [Hyperlink.serve(Jobs, jobsImpl)]).pipe(Layer.provide(Lookup.client(lookupNode))),
      );

      const dir = Context.get(lookupCtx, Directory.Tag);
      const conflict = yield* dir
        .advertise(
          new Lookup.AdvertiseRequest({
            nodeKey: Worker.key,
            kind: "IpcSocket",
            path: "/tmp/ask-blocked.sock",
            serves: ["lookup-dir/Jobs"],
            onConflict: "livenessReplace",
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
      yield* Effect.sync(() => workerCtx);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
  );

  it.effect("ListenOptions.onYield false → askIncumbent newcomer gets IncumbentAlive", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("ask-refuse-lookup");
      const workerPath = yield* tmpSock("ask-refuse-worker");
      const lookupNode = Node.Tag()("lookup/dir-ask-refuse", {
        path: lookupPath,
        onConflict: "askIncumbent",
      }).pipe(Node.asLookup);

      class Worker extends Node.Tag<Worker, Jobs>()(
        "lookup-dir/AskRefuseWorker",
        { path: workerPath },
      ) {}

      const lookupServer = yield* Layer.build(Lookup.layerNode(lookupNode));
      const lookupClient = yield* Layer.build(Lookup.client(lookupNode));
      const lookupCtx = Context.merge(lookupServer, lookupClient);

      const workerCtx = yield* Layer.build(
        Node.unix(Worker, [Hyperlink.serve(Jobs, jobsImpl)], {
          onYield: Effect.succeed(false),
        }).pipe(Layer.provide(Lookup.client(lookupNode))),
      );

      const dir = Context.get(lookupCtx, Directory.Tag);
      const conflict = yield* dir
        .advertise(
          new Lookup.AdvertiseRequest({
            nodeKey: Worker.key,
            kind: "IpcSocket",
            path: "/tmp/ask-refused.sock",
            serves: ["lookup-dir/Jobs"],
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
      yield* Effect.sync(() => workerCtx);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
  );
});

describe("Lookup directory draining ≠ dead", () => {
  it.effect("draining incumbent refuses askIncumbent yield; Directory row held", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("drain-lookup");
      const workerPath = yield* tmpSock("drain-worker");
      const lookupNode = Node.Tag()("lookup/dir-drain", {
        path: lookupPath,
        onConflict: "askIncumbent",
      }).pipe(Node.asLookup);

      class Worker extends Node.Tag<Worker, Jobs>()("lookup-dir/DrainWorker", {
        path: workerPath,
      }) {}

      const lookupServer = yield* Layer.build(Lookup.layerNode(lookupNode));
      const lookupClient = yield* Layer.build(Lookup.client(lookupNode));
      const lookupCtx = Context.merge(lookupServer, lookupClient);

      const workerCtx = yield* Layer.build(
        Node.unix(Worker, [Hyperlink.serve(Jobs, jobsImpl)]).pipe(
          Layer.provide(Lookup.client(lookupNode)),
        ),
      );

      yield* Node.drain(Worker);

      const dir = Context.get(lookupCtx, Directory.Tag);
      const conflict = yield* dir
        .advertise(
          new Lookup.AdvertiseRequest({
            nodeKey: Worker.key,
            kind: "IpcSocket",
            path: "/tmp/drain-newcomer.sock",
            serves: ["lookup-dir/Jobs"],
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
      if (conflict._tag === "alive") {
        expect(conflict.error.incumbent.path).toBe(workerPath);
      }

      const listed = yield* dir
        .nodesServing(
          new Lookup.NodesServingRequest({
            serviceKey: "lookup-dir/Jobs",
          }),
        )
        .pipe(Effect.provide(lookupCtx));
      expect(listed).toHaveLength(1);
      expect(listed[0]?.path).toBe(workerPath);

      yield* Effect.sync(() => workerCtx);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
  );
});

describe("Lookup directory membership push", () => {
  const awaitEvents = <A>(
    seen: Ref.Ref<ReadonlyArray<A>>,
    n: number,
  ) =>
    Effect.repeat(Ref.get(seen), {
      until: (a) => a.length >= n,
      schedule: Schedule.spaced(Duration.millis(5)),
    });

  // Sliding PubSub + stream subscribe needs a live clock (attach sleep / await poll).
  it.live("changes emits upsert then remove; dialChanged false on first advertise", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("push");
      const node = Node.Tag()("lookup/dir-push", { path }).pipe(Node.asLookup);

      yield* withLookup(
        Lookup.layerNode(node),
        Lookup.client(node),
        Effect.gen(function* () {
          const seen = yield* Ref.make<ReadonlyArray<Lookup.DirectoryChange>>(
            [],
          );
          yield* Lookup.changes.pipe(
            Stream.runForEach((event) =>
              Ref.update(seen, (current) => [...current, event]),
            ),
            Effect.forkScoped,
          );
          yield* Effect.sleep(Duration.millis(20));

          const dir = yield* Directory.Tag;
          yield* dir.advertise(
            new Lookup.AdvertiseRequest({
              nodeKey: "worker-a",
              kind: "IpcSocket",
              path: "/tmp/worker-a.sock",
              serves: ["lookup-dir/Jobs"],
            }),
          );
          yield* awaitEvents(seen, 1);

          const first = (yield* Ref.get(seen))[0];
          expect(first?._tag).toBe("DirectoryUpserted");
          if (first?._tag === "DirectoryUpserted") {
            expect(first.entry.nodeKey).toBe("worker-a");
            expect(first.dialChanged).toBe(false);
            expect(first.previous).toBeUndefined();
          }

          yield* dir.unregister(
            new Lookup.UnregisterRequest({ nodeKey: "worker-a" }),
          );
          yield* awaitEvents(seen, 2);

          const second = (yield* Ref.get(seen))[1];
          expect(second?._tag).toBe("DirectoryRemoved");
          if (second?._tag === "DirectoryRemoved") {
            expect(second.nodeKey).toBe("worker-a");
            expect(second.previous.path).toBe("/tmp/worker-a.sock");
          }
        }),
      );
    }).pipe(Effect.timeout(Duration.seconds(15))),
  );

  it.live("same-dial refresh upserts with dialChanged false", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("push-refresh");
      const node = Node.Tag()("lookup/dir-push-refresh", { path }).pipe(
        Node.asLookup,
      );

      yield* withLookup(
        Lookup.layerNode(node),
        Lookup.client(node),
        Effect.gen(function* () {
          const seen = yield* Ref.make<ReadonlyArray<Lookup.DirectoryChange>>(
            [],
          );
          yield* Lookup.changes.pipe(
            Stream.runForEach((event) =>
              Ref.update(seen, (current) => [...current, event]),
            ),
            Effect.forkScoped,
          );
          yield* Effect.sleep(Duration.millis(20));

          const dir = yield* Directory.Tag;
          yield* dir.advertise(
            new Lookup.AdvertiseRequest({
              nodeKey: "worker-a",
              kind: "IpcSocket",
              path: "/tmp/worker-a.sock",
              serves: ["lookup-dir/Jobs"],
            }),
          );
          yield* awaitEvents(seen, 1);

          yield* dir.advertise(
            new Lookup.AdvertiseRequest({
              nodeKey: "worker-a",
              kind: "IpcSocket",
              path: "/tmp/worker-a.sock",
              serves: ["lookup-dir/Jobs", "lookup-dir/Emails"],
            }),
          );
          yield* awaitEvents(seen, 2);

          const refresh = (yield* Ref.get(seen))[1];
          expect(refresh?._tag).toBe("DirectoryUpserted");
          if (refresh?._tag === "DirectoryUpserted") {
            expect(refresh.dialChanged).toBe(false);
            expect(refresh.previous?.serves).toEqual(["lookup-dir/Jobs"]);
            expect(refresh.entry.serves).toEqual([
              "lookup-dir/Jobs",
              "lookup-dir/Emails",
            ]);
          }
        }),
      );
    }).pipe(Effect.timeout(Duration.seconds(15))),
  );

  // Dead-incumbent replace probes a missing sock (Effect.timeout) — live clock.
  it.live("A→B dial replace publishes dialChanged true", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("push-dial");
      const node = Node.Tag()("lookup/dir-push-dial", { path }).pipe(
        Node.asLookup,
      );

      yield* withLookup(
        Lookup.layerNode(node),
        Lookup.client(node),
        Effect.gen(function* () {
          const seen = yield* Ref.make<ReadonlyArray<Lookup.DirectoryChange>>(
            [],
          );
          yield* Lookup.changes.pipe(
            Stream.runForEach((event) =>
              Ref.update(seen, (current) => [...current, event]),
            ),
            Effect.forkScoped,
          );
          yield* Effect.sleep(Duration.millis(20));

          const dir = yield* Directory.Tag;
          yield* dir.advertise(
            new Lookup.AdvertiseRequest({
              nodeKey: "worker-stale",
              kind: "IpcSocket",
              path: `/tmp/hyperlink-ts-lookup-dir-push-missing-${process.pid}.sock`,
              serves: ["lookup-dir/Jobs"],
            }),
          );
          yield* awaitEvents(seen, 1);

          yield* dir.advertise(
            new Lookup.AdvertiseRequest({
              nodeKey: "worker-stale",
              kind: "IpcSocket",
              path: "/tmp/worker-fresh.sock",
              serves: ["lookup-dir/Jobs"],
            }),
          );
          yield* awaitEvents(seen, 2);

          const swap = (yield* Ref.get(seen))[1];
          expect(swap?._tag).toBe("DirectoryUpserted");
          if (swap?._tag === "DirectoryUpserted") {
            expect(swap.dialChanged).toBe(true);
            expect(swap.entry.path).toBe("/tmp/worker-fresh.sock");
            expect(swap.previous?.path).toContain("push-missing");
          }
        }),
      );
    }).pipe(Effect.timeout(Duration.seconds(20))),
  );

  it.live("directoryTable tracks upserts and removes", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("push-table");
      const node = Node.Tag()("lookup/dir-push-table", { path }).pipe(
        Node.asLookup,
      );

      yield* withLookup(
        Lookup.layerNode(node),
        Lookup.client(node),
        Effect.gen(function* () {
          const table = yield* Lookup.directoryTable();
          yield* Effect.sleep(Duration.millis(20));

          const dir = yield* Directory.Tag;
          yield* dir.advertise(
            new Lookup.AdvertiseRequest({
              nodeKey: "worker-a",
              kind: "IpcSocket",
              path: "/tmp/worker-a.sock",
              serves: ["lookup-dir/Jobs"],
            }),
          );

          yield* Effect.repeat(table.getNode("worker-a"), {
            until: Option.isSome,
            schedule: Schedule.spaced(Duration.millis(5)),
          });
          const hit = yield* table.getNode("worker-a");
          expect(Option.isSome(hit)).toBe(true);
          if (Option.isSome(hit)) {
            expect(hit.value.path).toBe("/tmp/worker-a.sock");
          }

          yield* dir.unregister(
            new Lookup.UnregisterRequest({ nodeKey: "worker-a" }),
          );
          yield* Effect.repeat(table.getNode("worker-a"), {
            until: Option.isNone,
            schedule: Schedule.spaced(Duration.millis(5)),
          });
          expect(Option.isNone(yield* table.getNode("worker-a"))).toBe(true);
          expect((yield* table.get).size).toBe(0);
        }),
      );
    }).pipe(Effect.timeout(Duration.seconds(15))),
  );
});

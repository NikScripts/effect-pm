import { Clock, Context, Duration, Effect, Layer, Option, Schema } from "effect";
import { describe, it } from "@effect/vitest";
import { expect } from "vitest";
import * as Lookup from "../src/Lookup";
import * as Resource from "../src/Resource";
import * as Node from "../src/Node";
import { expectTaggedFailure } from "./fixtures/expectTaggedFailure";

// D7 — bootstrap, resolve, lookupClient, address-less listen, Prototype.make → class.

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/effect-pm-d7-${label}-${process.pid}-${now}.sock`;
  });

class Jobs extends Resource.Tag<Jobs>()("d7/Jobs", {
  jobs: Resource.effect(Schema.Number),
}) {}

const jobsImpl = { jobs: Effect.succeed(7) };

describe("Lookup.layerOptions", () => {
  it.effect("first process serves; second dials the same path", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("boot");
      const first = yield* Layer.build(
        Lookup.layerOptions({ path, unlink: false }),
      );
      const second = yield* Layer.build(
        Lookup.layerOptions({ path, unlink: false }),
      );
      const id = Context.get(second, Lookup.Identity);
      const won = yield* id
        .claim(
          new Lookup.ClaimRequest({
            key: "d7/k",
            nodeKey: "n",
            kind: "IpcSocket",
            path: "/tmp/n.sock",
          }),
        )
        .pipe(Effect.provide(second));
      expect(won.nodeKey).toBe("n");
      yield* Effect.sync(() => first);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
  );
});

describe("Lookup.Identity.resolve", () => {
  it.effect("returns Some after claim and None when missing", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("resolve");
      const node = Node.Lookup()("d7/resolve", { path });
      const serverCtx = yield* Layer.build(Lookup.layerNode(node));
      const clientCtx = yield* Layer.build(Lookup.client(node));
      const ctx = Context.merge(serverCtx, clientCtx);
      const id = Context.get(ctx, Lookup.Identity);

      const empty = yield* id
        .resolve(new Lookup.ResolveRequest({ key: "missing" }))
        .pipe(Effect.provide(ctx));
      expect(Option.isNone(empty)).toBe(true);

      yield* id
        .claim(
          new Lookup.ClaimRequest({
            key: "d7/Mail",
            nodeKey: "w",
            kind: "IpcSocket",
            path: "/tmp/w.sock",
          }),
        )
        .pipe(Effect.provide(ctx));

      const hit = yield* id
        .resolve(new Lookup.ResolveRequest({ key: "d7/Mail" }))
        .pipe(Effect.provide(ctx));
      expect(Option.isSome(hit)).toBe(true);
      if (Option.isSome(hit)) {
        expect(hit.value.path).toBe("/tmp/w.sock");
      }
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(15))),
  );
});

describe("Resource.lookupClient", () => {
  it.effect("dials via directory nodesServing after listen advertises", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("lc-lookup");
      const workerPath = yield* tmpSock("lc-worker");
      const lookupNode = Node.Lookup()("d7/lc-lookup", {
        path: lookupPath,
      });
      class Worker extends Node.Tag<Worker, Jobs>()("d7/lc-worker", {
        path: workerPath,
      }) {}

      const lookupClient = Lookup.client(lookupNode);
      const lookupServer = yield* Layer.build(Lookup.layerNode(lookupNode));
      const lookupCtx = yield* Layer.build(lookupClient);
      const lookup = Context.merge(lookupServer, lookupCtx);

      const worker = yield* Layer.build(
        Node.unix(Worker, [Resource.serve(Jobs, jobsImpl)]).pipe(Layer.provide(lookupClient)),
      );

      const dir = Context.get(lookup, Lookup.Directory);
      const rows = yield* dir
        .nodesServing(
          new Lookup.NodesServingRequest({ resourceKey: "d7/Jobs" }),
        )
        .pipe(Effect.provide(lookup));
      expect(rows.length).toBeGreaterThan(0);

      const client = yield* Layer.build(
        Resource.lookupClient(Jobs).pipe(Layer.provide(lookupClient)),
      );

      const n = yield* Effect.gen(function* () {
        const jobs = yield* Jobs;
        return yield* jobs.jobs;
      }).pipe(Effect.provide(Context.merge(lookup, Context.merge(worker, client))));
      expect(n).toBe(7);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
  );
});

describe("address-less listen", () => {
  it.effect(
    "mints a path, claims node.key, and serves",
    () =>
      Effect.gen(function* () {
        const lookupPath = yield* tmpSock("al-lookup");
        const lookupNode = Node.Lookup()("d7/al-lookup", {
          path: lookupPath,
        });
        class Worker extends Node.Tag<Worker, Jobs>()("d7/al-worker") {}

        const lookupClient = Lookup.client(lookupNode);
        const lookupServer = yield* Layer.build(Lookup.layerNode(lookupNode));
        const server = yield* Layer.build(
          Node.unix(Worker, [Resource.serve(Jobs, jobsImpl)]).pipe(Layer.provide(lookupClient)),
        );
        const client = yield* Layer.build(
          Resource.lookupClient(Jobs).pipe(Layer.provide(lookupClient)),
        );

        const n = yield* Effect.gen(function* () {
          const jobs = yield* Jobs;
          return yield* jobs.jobs;
        }).pipe(
          Effect.provide(
            Context.merge(lookupServer, Context.merge(server, client)),
          ),
        );
        expect(n).toBe(7);
      }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
    25_000,
  );

  it.effect(
    "second address-less listen with same Node.key fails AddressLessClaimLost",
    () =>
      Effect.gen(function* () {
        const lookupPath = yield* tmpSock("al2-lookup");
        class Worker extends Node.Tag<Worker, Jobs>()("d7/al2-worker") {}

        const lookup = Lookup.layerOptions({ path: lookupPath });
        const first = yield* Layer.build(
          Node.unix(Worker, [Resource.serve(Jobs, jobsImpl)]).pipe(Layer.provide(lookup)),
        );

        const exit = yield* Effect.exit(
          Layer.build(
            Node.unix(Worker, [Resource.serve(Jobs, jobsImpl)]).pipe(Layer.provide(lookup)),
          ).pipe(Effect.scoped),
        );
        expectTaggedFailure(exit, "AddressLessClaimLost");
        yield* Effect.sync(() => first);
      }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
    25_000,
  );
});

describe("Node.Prototype.make", () => {
  it("creates a constructible Node class with #name wire key", () => {
    class MailWorker extends Node.Prototype<MailWorker, Jobs>(
      "d7/MailWorker",
    ) {}
    class East extends MailWorker.make("East", {
      path: "/tmp/d7-east.sock",
    }) {}
    expect(East.key).toBe("d7/MailWorker#East");
    expect(East.path).toBe("/tmp/d7-east.sock");
    expect(East.kind).toBe("IpcSocket");
    expect(MailWorker.isPrototype).toBe(true);
  });
});

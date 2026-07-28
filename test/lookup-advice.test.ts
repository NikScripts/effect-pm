import { Clock, Context, Duration, Effect, Layer, Schema } from "effect";
import { describe, it } from "@effect/vitest";
import { expect } from "vitest";
import * as Lookup from "../src/Lookup";
import * as Node from "../src/Node";
import * as Hyperlink from "../src/Hyperlink";
import { expectTaggedFailure } from "./fixtures/expectTaggedFailure";

// M5 — placement advice board on Lookup; lookupClient honors prefer before D4 pick.

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/hyperlink-ts-lookup-adv-${label}-${process.pid}-${now}.sock`;
  });

class Jobs extends Hyperlink.Tag<Jobs>()("lookup-adv/Jobs", {
  jobs: Hyperlink.effect(Schema.Number),
}) {}

describe("Lookup Advice", () => {
  it.effect("advise / preferred / clear are last-write-wins", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("crud");
      const node = Node.Tag()("lookup/adv-crud", { path }).pipe(Node.asLookup);

      const server = yield* Layer.build(Lookup.layerNode(node));
      const client = yield* Layer.build(Lookup.client(node));
      const ctx = Context.merge(server, client);

      yield* Effect.gen(function* () {
        const set = yield* Lookup.prefer(Jobs, "worker-a");
        expect(set).toBe("worker-a");

        const first = yield* Lookup.preferred(Jobs.key);
        expect(first._tag).toBe("Some");
        if (first._tag === "Some") {
          expect(first.value).toBe("worker-a");
        }

        yield* Lookup.preferEntry(Jobs.key, { nodeKey: "worker-b" });
        const second = yield* Lookup.preferred(Jobs.key);
        expect(second._tag).toBe("Some");
        if (second._tag === "Some") {
          expect(second.value).toBe("worker-b");
        }

        const cleared = yield* Lookup.clearAdvice(Jobs.key);
        expect(cleared).toBe(true);
        const empty = yield* Lookup.preferred(Jobs.key);
        expect(empty._tag).toBe("None");
      }).pipe(Effect.provide(ctx));
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(15))),
  );

  it.effect("lookupClient honors advice over bare ambiguous fail-closed", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("honor-lookup");
      const lookupNode = Node.Tag()("lookup/adv-honor", {
        path: lookupPath,
      }).pipe(Node.asLookup);
      const lookupClient = Lookup.client(lookupNode);

      const lookupServer = yield* Layer.build(Lookup.layerNode(lookupNode));
      const lookupCtx = yield* Layer.build(lookupClient);
      const lookup = Context.merge(lookupServer, lookupCtx);

      const a = yield* Layer.build(
        Node.unix([
          Hyperlink.serve(Jobs, { jobs: Effect.succeed(3) }),
        ]).pipe(Layer.provide(lookupClient)),
      );
      const b = yield* Layer.build(
        Node.unix([
          Hyperlink.serve(Jobs, { jobs: Effect.succeed(5) }),
        ]).pipe(Layer.provide(lookupClient)),
      );

      const dir = Context.get(lookup, Lookup.Directory);
      const rows = yield* dir
        .nodesServing(
          new Lookup.NodesServingRequest({ serviceKey: Jobs.key }),
        )
        .pipe(Effect.provide(lookup));
      expect(rows.length).toBe(2);

      const preferB = rows.find((r) => {
        const nodeB = Context.get(b, Node.ListenNode);
        return r.nodeKey === nodeB.key;
      });
      expect(preferB).toBeDefined();

      // Bare client still fail-closed without advice.
      const bareExit = yield* Effect.exit(
        Layer.build(
          Hyperlink.lookupClient(Jobs).pipe(Layer.provide(lookupClient)),
        ).pipe(Effect.scoped),
      );
      expectTaggedFailure(bareExit, "LookupClientError");

      yield* Lookup.advise({
        serviceKey: Jobs.key,
        prefer: preferB!.nodeKey,
      }).pipe(Effect.provide(lookup));

      const soft = yield* Layer.build(
        Hyperlink.lookupClient(Jobs).pipe(Layer.provide(lookupClient)),
      );
      const n = yield* Effect.gen(function* () {
        const jobs = yield* Jobs;
        return yield* jobs.jobs;
      }).pipe(
        Effect.provide(
          Context.merge(lookup, Context.merge(a, Context.merge(b, soft))),
        ),
      );
      expect(n).toBe(5);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(25))),
  );

  it.effect("stale advice falls through to pick / ambiguous", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("stale-lookup");
      const lookupNode = Node.Tag()("lookup/adv-stale", {
        path: lookupPath,
      }).pipe(Node.asLookup);
      const lookupClient = Lookup.client(lookupNode);

      const lookupServer = yield* Layer.build(Lookup.layerNode(lookupNode));
      const lookupCtx = yield* Layer.build(lookupClient);
      const lookup = Context.merge(lookupServer, lookupCtx);

      const a = yield* Layer.build(
        Node.unix([
          Hyperlink.serve(Jobs, { jobs: Effect.succeed(3) }),
        ]).pipe(Layer.provide(lookupClient)),
      );
      const b = yield* Layer.build(
        Node.unix([
          Hyperlink.serve(Jobs, { jobs: Effect.succeed(5) }),
        ]).pipe(Layer.provide(lookupClient)),
      );

      yield* Lookup.advise({
        serviceKey: Jobs.key,
        prefer: "lookup-adv/Jobs#does-not-exist",
      }).pipe(Effect.provide(lookup));

      const staleExit = yield* Effect.exit(
        Layer.build(
          Hyperlink.lookupClient(Jobs).pipe(Layer.provide(lookupClient)),
        ).pipe(Effect.scoped),
      );
      expectTaggedFailure(staleExit, "LookupClientError");

      const soft = yield* Layer.build(
        Hyperlink.lookupClient(Jobs, { pick: "first" }).pipe(
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
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(25))),
  );
});

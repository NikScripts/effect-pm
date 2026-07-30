/**
 * Live A→B cutover — Locked #39 handoff + WorkPool baked `releaseEnqueueHandoff`.
 *
 * Crown-jewel coverage: B is Directory-visible **before** A shuts down (peer pick excludes
 * self by dial, not nodeKey). Membership rebind-only suites (shutdown A, then start B) live
 * elsewhere (`lookup-client-rebind`, `lookup-d3-peers`).
 *
 * Matrix (labels are stable for grep / brief cites):
 * - L1 / L1b / L8 / L14 — WorkPool bake + lookupClient + payload fidelity
 * - L-same / L16 — same nodeKey + askIncumbent then dial-peer transfer
 * - L2 / L15 / L17 — custom take→give / empty / peer identity
 * - L3 / L4 / L4b / L10 / L11 — defer paths (NoPeer, peer gone, give fail, Failed, RetryExhausted)
 * - L5 / L9 — Retry→Done / void→Done
 * - L6 / L18 — multi-service Done+Defer / dual Done
 * - L7 — mid-handoff draining refuses askIncumbent
 * - L12 — NoPeer defer then retry after B joins
 * - L13 — three peers, first non-self dial
 * - L19 — Advice cleared on successful leave
 * - L20 — WorkPool.serveRemote bake
 */
import {
  Clock,
  Context,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Predicate,
  Ref,
  Schedule,
  Schema,
} from "effect";
import { describe, expect, it } from "@effect/vitest";
import * as Hyperlink from "../src/Hyperlink";
import * as Lookup from "../src/Lookup";
import * as Directory from "../src/Directory";
import * as Node from "../src/Node";
import * as WorkPool from "../src/WorkPool";
import { DEFAULT_HANDOFF_RETRIES } from "../src/internal/hyperlinkHandoff";
import {
  NodeStatusTag,
  client as nodeStatusClient,
} from "../src/internal/nodeStatus";
import { expectTaggedFailure } from "./fixtures/expectTaggedFailure";

const Item = Schema.Struct({ n: Schema.Number });
type Item = { readonly n: number };

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/hyperlink-ts-ab-${label}-${process.pid}-${now}.sock`;
  });

const waitUntil = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  until: (value: A) => boolean,
) =>
  Effect.repeat(effect, {
    until,
    schedule: Schedule.spaced(Duration.millis(25)),
  });

const nodesServing = (
  lookupCtx: Context.Context<Directory.Tag>,
  serviceKey: string,
) =>
  Context.get(lookupCtx, Directory.Tag)
    .nodesServing(new Lookup.NodesServingRequest({ serviceKey }))
    .pipe(Effect.provide(lookupCtx));

/**
 * Match `HandoffDeferred` by `_tag` (never `instanceof` / message strings) + PascalCase reason.
 */
const expectHandoffDeferred = (
  err: unknown,
  expected: {
    readonly reason: Hyperlink.HandoffDeferralReason;
    readonly serviceKey: string;
  },
): void => {
  expect(Predicate.isTagged(err, "HandoffDeferred")).toBe(true);
  if (
    typeof err !== "object" ||
    err === null ||
    !("_tag" in err) ||
    err._tag !== "HandoffDeferred" ||
    !("reason" in err) ||
    !("serviceKey" in err)
  ) {
    throw new Error(
      `expected HandoffDeferred with reason/serviceKey, got ${String(err)}`,
    );
  }
  expect(err.reason).toBe(expected.reason);
  expect(err.serviceKey).toBe(expected.serviceKey);
};

const nodePhase = (node: Node.AddressedNode<unknown>) =>
  Effect.flatMap(NodeStatusTag, (status) =>
    Effect.map(status.status.get, (snap) => snap.phase),
  ).pipe(Effect.provide(nodeStatusClient(node)), Effect.scoped);

describe("A→B cutover — WorkPool baked releaseEnqueueHandoff", () => {
  it.live(
    "L1: pending items transfer A→B when B is already Directory-visible (exclude self by dial)",
    () =>
      Effect.gen(function* () {
        const lookupPath = yield* tmpSock("l1-lookup");
        const pathA = yield* tmpSock("l1-a");
        const pathB = yield* tmpSock("l1-b");

        const lookupNode = Node.Tag()("ab/l1-lookup", {
          path: lookupPath,
        }).pipe(Node.asLookup);

        class Jobs extends WorkPool.Tag<Jobs>()("ab/l1/Jobs", {
          payload: Item,
        }) {}

        // Different nodeKeys so both rows coexist — peer pick is by dial, not key.
        class WorkerA extends Node.Tag<WorkerA, Jobs>()("ab/l1/WorkerA", {
          path: pathA,
        }) {}
        class WorkerB extends Node.Tag<WorkerB, Jobs>()("ab/l1/WorkerB", {
          path: pathB,
        }) {}

        const lookupClient = Lookup.client(lookupNode);
        yield* Layer.build(Lookup.layerNode(lookupNode));
        const lookupCtx = yield* Layer.build(lookupClient);

        // B first: Directory has a non-self dial for A's handoff.
        const bCtx = yield* Layer.build(
          Node.unix(WorkerB, [
            WorkPool.serve(Jobs, { effect: () => Effect.void }).pipe(Hyperlink.deferStart),
          ]).pipe(Layer.provide(lookupClient)),
        );

        const aCtx = yield* Layer.build(
          Node.unix(WorkerA, [
            WorkPool.serve(Jobs, { effect: () => Effect.void }).pipe(Hyperlink.deferStart),
          ]).pipe(Layer.provide(lookupClient)),
        );

        yield* waitUntil(
          nodesServing(lookupCtx, Jobs.key),
          (rows) => rows.length === 2,
        );

        yield* Effect.gen(function* () {
          const q = yield* Jobs;
          yield* q.add([{ n: 1 }, { n: 2 }, { n: 3 }]);
          const snap = yield* q.status.get;
          expect(snap.sizes.normal).toBe(3);
        }).pipe(Effect.provide(aCtx));

        yield* Node.shutdown(WorkerA);

        // A left; only B remains.
        yield* waitUntil(
          nodesServing(lookupCtx, Jobs.key),
          (rows) =>
            rows.length === 1 && rows[0]?.nodeKey === WorkerB.key,
        );

        // Pending landed on B (still deferStart — workers not forked).
        const bSnap = yield* Effect.gen(function* () {
          const q = yield* Jobs;
          return yield* q.status.get;
        }).pipe(Effect.provide(Hyperlink.client(Jobs, WorkerB)), Effect.scoped);

        expect(bSnap.sizes.normal).toBe(3);

        // A is unregistered — Directory must not still advertise Worker's dial.
        const after = yield* nodesServing(lookupCtx, Jobs.key);
        expect(after.every((r) => r.nodeKey !== WorkerA.key)).toBe(true);
        expect(after.every((r) => r.path !== pathA)).toBe(true);

        yield* Effect.sync(() => {
          void aCtx;
          void bCtx;
        });
      }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(35))),
  );

  it.live("L1b: empty WorkPool + peer present ⇒ Done; A leaves cleanly", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("l1b-lookup");
      const pathA = yield* tmpSock("l1b-a");
      const pathB = yield* tmpSock("l1b-b");

      const lookupNode = Node.Tag()("ab/l1b-lookup", {
        path: lookupPath,
      }).pipe(Node.asLookup);

      class Jobs extends WorkPool.Tag<Jobs>()("ab/l1b/Jobs", {
        payload: Item,
      }) {}
      class WorkerA extends Node.Tag<WorkerA, Jobs>()("ab/l1b/WorkerA", {
        path: pathA,
      }) {}
      class WorkerB extends Node.Tag<WorkerB, Jobs>()("ab/l1b/WorkerB", {
        path: pathB,
      }) {}

      const lookupClient = Lookup.client(lookupNode);
      yield* Layer.build(Lookup.layerNode(lookupNode));
      const lookupCtx = yield* Layer.build(lookupClient);

      yield* Layer.build(
        Node.unix(WorkerB, [
          WorkPool.serve(Jobs, { effect: () => Effect.void,  }).pipe(Hyperlink.deferStart),
        ]).pipe(Layer.provide(lookupClient)),
      );
      yield* Layer.build(
        Node.unix(WorkerA, [
          WorkPool.serve(Jobs, { effect: () => Effect.void,  }).pipe(Hyperlink.deferStart),
        ]).pipe(Layer.provide(lookupClient)),
      );

      yield* waitUntil(
        nodesServing(lookupCtx, Jobs.key),
        (rows) => rows.length === 2,
      );

      yield* Node.shutdown(WorkerA);

      yield* waitUntil(
        nodesServing(lookupCtx, Jobs.key),
        (rows) =>
          rows.length === 1 && rows[0]?.nodeKey === WorkerB.key,
      );
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(30))),
  );

  it.live(
    "L8: after transfer, lookupClient reads B without restart (Directory already on B)",
    () =>
      Effect.gen(function* () {
        const lookupPath = yield* tmpSock("l8-lookup");
        const pathA = yield* tmpSock("l8-a");
        const pathB = yield* tmpSock("l8-b");

        const lookupNode = Node.Tag()("ab/l8-lookup", {
          path: lookupPath,
        }).pipe(Node.asLookup);

        class Jobs extends WorkPool.Tag<Jobs>()("ab/l8/Jobs", {
          payload: Item,
        }) {}
        class WorkerA extends Node.Tag<WorkerA, Jobs>()("ab/l8/WorkerA", {
          path: pathA,
        }) {}
        class WorkerB extends Node.Tag<WorkerB, Jobs>()("ab/l8/WorkerB", {
          path: pathB,
        }) {}

        const lookupClient = Lookup.client(lookupNode);
        yield* Layer.build(Lookup.layerNode(lookupNode));
        const lookupCtx = yield* Layer.build(lookupClient);

        yield* Layer.build(
          Node.unix(WorkerB, [
            WorkPool.serve(Jobs, { effect: () => Effect.void }).pipe(Hyperlink.deferStart),
          ]).pipe(Layer.provide(lookupClient)),
        );
        const aCtx = yield* Layer.build(
          Node.unix(WorkerA, [
            WorkPool.serve(Jobs, { effect: () => Effect.void }).pipe(Hyperlink.deferStart),
          ]).pipe(Layer.provide(lookupClient)),
        );

        yield* waitUntil(
          nodesServing(lookupCtx, Jobs.key),
          (rows) => rows.length === 2,
        );

        yield* Effect.gen(function* () {
          const q = yield* Jobs;
          yield* q.add([{ n: 7 }, { n: 8 }]);
        }).pipe(Effect.provide(aCtx));

        // Prefer B so lookupClient is unambiguous after A leaves (and during dual-serve).
        yield* Lookup.advise({
          serviceKey: Jobs.key,
          prefer: WorkerB.key,
        }).pipe(Effect.provide(lookupCtx));

        const clientCtx = yield* Layer.build(
          Hyperlink.lookupClient(Jobs).pipe(Layer.provide(lookupClient)),
        );

        yield* Node.shutdown(WorkerA);

        yield* waitUntil(
          nodesServing(lookupCtx, Jobs.key),
          (rows) => rows.length === 1,
        );

        const snap = yield* Effect.gen(function* () {
          const q = yield* Jobs;
          return yield* q.status.get;
        }).pipe(Effect.provide(clientCtx));

        expect(snap.sizes.normal).toBe(2);
      }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(35))),
  );
});

describe("A→B cutover — same nodeKey + askIncumbent then handoff", () => {
  it.live(
    "L-same: B replaces Directory row (yield); A shutdown still peers by dial and transfers",
    () =>
      Effect.gen(function* () {
        const lookupPath = yield* tmpSock("same-lookup");
        const pathA = yield* tmpSock("same-a");
        const pathB = yield* tmpSock("same-b");

        const lookupNode = Node.Tag()("ab/same-lookup", {
          path: lookupPath,
          onConflict: "askIncumbent",
        }).pipe(Node.asLookup);

        class Jobs extends WorkPool.Tag<Jobs>()("ab/same/Jobs", {
          payload: Item,
        }) {}

        // Same nodeKey string; different socks.
        class WorkerA extends Node.Tag<WorkerA, Jobs>()("ab/same/Worker", {
          path: pathA,
        }) {}
        class WorkerB extends Node.Tag<WorkerB, Jobs>()("ab/same/Worker", {
          path: pathB,
        }) {}

        const lookupClient = Lookup.client(lookupNode);
        yield* Layer.build(Lookup.layerNode(lookupNode));
        const lookupCtx = yield* Layer.build(lookupClient);

        const aCtx = yield* Layer.build(
          Node.unix(
            WorkerA,
            [
              WorkPool.serve(Jobs, { effect: () => Effect.void }).pipe(Hyperlink.deferStart),
            ],
            { onYield: Effect.succeed(true) },
          ).pipe(Layer.provide(lookupClient)),
        );

        yield* Effect.gen(function* () {
          const q = yield* Jobs;
          yield* q.add([{ n: 10 }, { n: 11 }]);
        }).pipe(Effect.provide(aCtx));

        // B advertises → askIncumbent → A yields → Directory dial moves to B.
        yield* Layer.build(
          Node.unix(
            WorkerB,
            [
              WorkPool.serve(Jobs, { effect: () => Effect.void }).pipe(Hyperlink.deferStart),
            ],
            { onConflict: "inherit" },
          ).pipe(Layer.provide(lookupClient)),
        );

        yield* waitUntil(nodesServing(lookupCtx, Jobs.key), (rows) => {
          const row = rows.find((r) => r.nodeKey === WorkerA.key);
          return row !== undefined && row.path === pathB;
        });

        // A still holds pending locally; Directory points at B's dial.
        yield* Node.shutdown(WorkerA);

        const bSnap = yield* Effect.gen(function* () {
          const q = yield* Jobs;
          return yield* q.status.get;
        }).pipe(Effect.provide(Hyperlink.client(Jobs, WorkerB)), Effect.scoped);

        expect(bSnap.sizes.normal).toBe(2);

        // Dial-matched unregister of A must not wipe B.
        const rows = yield* nodesServing(lookupCtx, Jobs.key);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.path).toBe(pathB);
      }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(40))),
  );
});

describe("A→B cutover — custom Hyperlink.serve { handoff }", () => {
  it.live("L2: custom take→give with peer present moves state A→B", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("l2-lookup");
      const pathA = yield* tmpSock("l2-a");
      const pathB = yield* tmpSock("l2-b");

      const lookupNode = Node.Tag()("ab/l2-lookup", {
        path: lookupPath,
      }).pipe(Node.asLookup);

      class Mover extends Hyperlink.Tag<Mover>()("ab/l2/Mover", {
        take: Hyperlink.effect(Schema.Array(Schema.String)),
        give: Hyperlink.effectFn(Schema.Array(Schema.String), Schema.Void),
        snapshot: Hyperlink.effect(Schema.Array(Schema.String)),
      }) {}

      class WorkerA extends Node.Tag<WorkerA, Mover>()("ab/l2/WorkerA", {
        path: pathA,
      }) {}
      class WorkerB extends Node.Tag<WorkerB, Mover>()("ab/l2/WorkerB", {
        path: pathB,
      }) {}

      const lookupClient = Lookup.client(lookupNode);
      yield* Layer.build(Lookup.layerNode(lookupNode));
      const lookupCtx = yield* Layer.build(lookupClient);

      const storeB = yield* Ref.make<ReadonlyArray<string>>([]);
      const storeA = yield* Ref.make<ReadonlyArray<string>>(["alpha", "beta"]);

      const moverImpl = (store: Ref.Ref<ReadonlyArray<string>>) => ({
        take: Effect.gen(function* () {
          const items = yield* Ref.get(store);
          yield* Ref.set(store, []);
          return items;
        }),
        give: (items: ReadonlyArray<string>) =>
          Ref.update(store, (a) => [...a, ...items]),
        snapshot: Ref.get(store),
      });

      const handoff = (
        from: { readonly take: Effect.Effect<ReadonlyArray<string>> },
        to: {
          readonly give: (
            items: ReadonlyArray<string>,
          ) => Effect.Effect<void>;
        },
        ctx: Hyperlink.HandoffContext,
      ) =>
        Effect.gen(function* () {
          const items = yield* from.take;
          if (items.length === 0) return yield* ctx.done;
          yield* to.give(items);
          return yield* ctx.done;
        });

      yield* Layer.build(
        Node.unix(WorkerB, [
          Hyperlink.serve(Mover, moverImpl(storeB), { handoff }),
        ]).pipe(Layer.provide(lookupClient)),
      );
      yield* Layer.build(
        Node.unix(WorkerA, [
          Hyperlink.serve(Mover, moverImpl(storeA), { handoff }),
        ]).pipe(Layer.provide(lookupClient)),
      );

      yield* waitUntil(
        nodesServing(lookupCtx, Mover.key),
        (rows) => rows.length === 2,
      );

      yield* Node.shutdown(WorkerA);

      expect(yield* Ref.get(storeA)).toEqual([]);
      expect(yield* Ref.get(storeB)).toEqual(["alpha", "beta"]);

      const remote = yield* Effect.gen(function* () {
        const m = yield* Mover;
        return yield* m.snapshot;
      }).pipe(Effect.provide(Hyperlink.client(Mover, WorkerB)), Effect.scoped);
      expect(remote).toEqual(["alpha", "beta"]);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(30))),
  );

  it.live(
    "L4: peer gone before handoff ⇒ HandoffDeferred(Failed|NoPeer); A stays up with state",
    () =>
      Effect.gen(function* () {
        const lookupPath = yield* tmpSock("l4-lookup");
        const pathA = yield* tmpSock("l4-a");
        const pathB = yield* tmpSock("l4-b");

        const lookupNode = Node.Tag()("ab/l4-lookup", {
          path: lookupPath,
        }).pipe(Node.asLookup);

        class Mover extends Hyperlink.Tag<Mover>()("ab/l4/Mover", {
          take: Hyperlink.effect(Schema.Array(Schema.String)),
          give: Hyperlink.effectFn(Schema.Array(Schema.String), Schema.Void),
        }) {}

        class WorkerA extends Node.Tag<WorkerA, Mover>()("ab/l4/WorkerA", {
          path: pathA,
        }) {}
        class WorkerB extends Node.Tag<WorkerB, Mover>()("ab/l4/WorkerB", {
          path: pathB,
        }) {}

        const lookupClient = Lookup.client(lookupNode);
        yield* Layer.build(Lookup.layerNode(lookupNode));
        const lookupCtx = yield* Layer.build(lookupClient);

        const storeA = yield* Ref.make<ReadonlyArray<string>>(["keep-me"]);
        const storeB = yield* Ref.make<ReadonlyArray<string>>([]);

        const moverImpl = (store: Ref.Ref<ReadonlyArray<string>>) => ({
          take: Effect.gen(function* () {
            const items = yield* Ref.get(store);
            yield* Ref.set(store, []);
            return items;
          }),
          give: (items: ReadonlyArray<string>) =>
            Ref.update(store, (a) => [...a, ...items]),
        });

        // B has NO handoff — can shut down cleanly without needing a peer.
        const bFiber = yield* Layer.build(
          Node.unix(WorkerB, [
            Hyperlink.serve(Mover, moverImpl(storeB)),
          ]).pipe(Layer.provide(lookupClient)),
        );

        yield* Layer.build(
          Node.unix(WorkerA, [
            Hyperlink.serve(Mover, moverImpl(storeA), {
              handoff: (
                from: {
                  readonly take: Effect.Effect<ReadonlyArray<string>>;
                },
                to: {
                  readonly give: (
                    items: ReadonlyArray<string>,
                  ) => Effect.Effect<void>;
                },
                ctx: Hyperlink.HandoffContext,
              ) =>
                Effect.gen(function* () {
                  const items = yield* from.take;
                  if (items.length === 0) return yield* ctx.done;
                  // Re-queue locally if peer give fails so we don't lose work.
                  const exit = yield* Effect.exit(to.give(items));
                  if (Exit.isFailure(exit)) {
                    yield* Ref.set(storeA, items);
                    return yield* ctx.defer;
                  }
                  return yield* ctx.done;
                }),
            }),
          ]).pipe(Layer.provide(lookupClient)),
        );

        yield* waitUntil(
          nodesServing(lookupCtx, Mover.key),
          (rows) => rows.length === 2,
        );

        // Tear B down so A's peer dial / give fails.
        yield* Node.shutdown(WorkerB);
        yield* Effect.sync(() => {
          void bFiber;
        });

        const err = yield* Effect.flip(Node.shutdown(WorkerA));
        expect(Predicate.isTagged(err, "HandoffDeferred")).toBe(true);
        if (!Predicate.isTagged(err, "HandoffDeferred")) {
          throw new Error(`expected HandoffDeferred, got ${err._tag}`);
        }
        expect(["Failed", "NoPeer", "Defer"]).toContain(err.reason);
        expect(err.serviceKey).toBe(Mover.key);

        // A restored locally — either never took, or re-queued after failed give.
        expect(yield* Ref.get(storeA)).toEqual(["keep-me"]);
        expect(yield* nodePhase(WorkerA)).toBe("running");

        // A still advertised (did not leave).
        const rows = yield* nodesServing(lookupCtx, Mover.key);
        expect(rows.some((r) => r.nodeKey === WorkerA.key)).toBe(true);
      }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(35))),
    60_000,
  );

  it.live("L5: Retry then Done over a live peer", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("l5-lookup");
      const pathA = yield* tmpSock("l5-a");
      const pathB = yield* tmpSock("l5-b");

      const lookupNode = Node.Tag()("ab/l5-lookup", {
        path: lookupPath,
      }).pipe(Node.asLookup);

      class Ping extends Hyperlink.Tag<Ping>()("ab/l5/Ping", {
        ping: Hyperlink.effect(Schema.Number),
      }) {}

      class WorkerA extends Node.Tag<WorkerA, Ping>()("ab/l5/WorkerA", {
        path: pathA,
      }) {}
      class WorkerB extends Node.Tag<WorkerB, Ping>()("ab/l5/WorkerB", {
        path: pathB,
      }) {}

      const lookupClient = Lookup.client(lookupNode);
      yield* Layer.build(Lookup.layerNode(lookupNode));
      const lookupCtx = yield* Layer.build(lookupClient);

      const attempts = yield* Ref.make(0);

      yield* Layer.build(
        Node.unix(WorkerB, [
          Hyperlink.serve(Ping, { ping: Effect.succeed(1) }),
        ]).pipe(Layer.provide(lookupClient)),
      );
      yield* Layer.build(
        Node.unix(WorkerA, [
          Hyperlink.serve(
            Ping,
            { ping: Effect.succeed(0) },
            {
              handoff: (_from, _to, ctx) =>
                Effect.gen(function* () {
                  const n = yield* Ref.updateAndGet(attempts, (a) => a + 1);
                  if (n < 3) return yield* ctx.retry;
                  return yield* ctx.done;
                }),
            },
          ),
        ]).pipe(Layer.provide(lookupClient)),
      );

      yield* waitUntil(
        nodesServing(lookupCtx, Ping.key),
        (rows) => rows.length === 2,
      );

      yield* Node.shutdown(WorkerA);
      expect(yield* Ref.get(attempts)).toBe(3);

      yield* waitUntil(
        nodesServing(lookupCtx, Ping.key),
        (rows) =>
          rows.length === 1 && rows[0]?.nodeKey === WorkerB.key,
      );
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(30))),
  );

  it.live("L3: sole node with handoff ⇒ NoPeer defer (suite control)", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("l3-lookup");
      const pathA = yield* tmpSock("l3-a");

      const lookupNode = Node.Tag()("ab/l3-lookup", {
        path: lookupPath,
      }).pipe(Node.asLookup);

      class Jobs extends WorkPool.Tag<Jobs>()("ab/l3/Jobs", {
        payload: Item,
      }) {}
      class WorkerA extends Node.Tag<WorkerA, Jobs>()("ab/l3/WorkerA", {
        path: pathA,
      }) {}

      const lookupClient = Lookup.client(lookupNode);
      yield* Layer.build(Lookup.layerNode(lookupNode));
      const lookupCtx = yield* Layer.build(lookupClient);

      yield* Layer.build(
        Node.unix(WorkerA, [
          WorkPool.serve(Jobs, { effect: () => Effect.void,  }).pipe(Hyperlink.deferStart),
        ]).pipe(Layer.provide(lookupClient)),
      );

      const err = yield* Effect.flip(Node.shutdown(WorkerA));
      expectHandoffDeferred(err, {
        reason: "NoPeer",
        serviceKey: Jobs.key,
      });
      expect(yield* nodePhase(WorkerA)).toBe("running");

      const rows = yield* nodesServing(lookupCtx, Jobs.key);
      expect(rows.some((r) => r.nodeKey === WorkerA.key)).toBe(true);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(25))),
    60_000,
  );
});

describe("A→B cutover — multi-service + membership", () => {
  it.live(
    "L6: one service Done + one Defer ⇒ shutdown fails; node stays; Done transfer kept",
    () =>
      Effect.gen(function* () {
        const lookupPath = yield* tmpSock("l6-lookup");
        const pathA = yield* tmpSock("l6-a");
        const pathB = yield* tmpSock("l6-b");

        const lookupNode = Node.Tag()("ab/l6-lookup", {
          path: lookupPath,
        }).pipe(Node.asLookup);

        class Alpha extends Hyperlink.Tag<Alpha>()("ab/l6/Alpha", {
          take: Hyperlink.effect(Schema.Array(Schema.String)),
          give: Hyperlink.effectFn(Schema.Array(Schema.String), Schema.Void),
        }) {}
        class Beta extends Hyperlink.Tag<Beta>()("ab/l6/Beta", {
          noop: Hyperlink.effect(Schema.Void),
        }) {}

        class WorkerA extends Node.Tag<WorkerA, Alpha | Beta>()(
          "ab/l6/WorkerA",
          { path: pathA },
        ) {}
        class WorkerB extends Node.Tag<WorkerB, Alpha | Beta>()(
          "ab/l6/WorkerB",
          { path: pathB },
        ) {}

        const lookupClient = Lookup.client(lookupNode);
        yield* Layer.build(Lookup.layerNode(lookupNode));
        const lookupCtx = yield* Layer.build(lookupClient);

        const alphaA = yield* Ref.make<ReadonlyArray<string>>(["x"]);
        const alphaB = yield* Ref.make<ReadonlyArray<string>>([]);

        const alphaImpl = (store: Ref.Ref<ReadonlyArray<string>>) => ({
          take: Effect.gen(function* () {
            const items = yield* Ref.get(store);
            yield* Ref.set(store, []);
            return items;
          }),
          give: (items: ReadonlyArray<string>) =>
            Ref.update(store, (a) => [...a, ...items]),
        });

        const alphaHandoff = (
          from: { readonly take: Effect.Effect<ReadonlyArray<string>> },
          to: {
            readonly give: (
              items: ReadonlyArray<string>,
            ) => Effect.Effect<void>;
          },
          ctx: Hyperlink.HandoffContext,
        ) =>
          Effect.gen(function* () {
            const items = yield* from.take;
            if (items.length > 0) yield* to.give(items);
            return yield* ctx.done;
          });

        yield* Layer.build(
          Node.unix(WorkerB, [
            Hyperlink.serve(Alpha, alphaImpl(alphaB), {
              handoff: alphaHandoff,
            }),
            Hyperlink.serve(Beta, { noop: Effect.void }, {
              handoff: (_f, _t, ctx) => ctx.done,
            }),
          ]).pipe(Layer.provide(lookupClient)),
        );

        yield* Layer.build(
          Node.unix(WorkerA, [
            Hyperlink.serve(Alpha, alphaImpl(alphaA), {
              handoff: alphaHandoff,
            }),
            Hyperlink.serve(Beta, { noop: Effect.void }, {
              handoff: (_f, _t, ctx) => ctx.defer,
            }),
          ]).pipe(Layer.provide(lookupClient)),
        );

        yield* waitUntil(
          nodesServing(lookupCtx, Alpha.key),
          (rows) => rows.length === 2,
        );

        const err = yield* Effect.flip(Node.shutdown(WorkerA));
        expectHandoffDeferred(err, {
          reason: "Defer",
          serviceKey: Beta.key,
        });
        expect(yield* nodePhase(WorkerA)).toBe("running");

        // Alpha may already have transferred (unbounded forEach, first fail after).
        expect(yield* Ref.get(alphaB)).toEqual(["x"]);
        expect(yield* Ref.get(alphaA)).toEqual([]);

        // A did not leave — both service ads still list A.
        const alphaRows = yield* nodesServing(lookupCtx, Alpha.key);
        const betaRows = yield* nodesServing(lookupCtx, Beta.key);
        expect(alphaRows.some((r) => r.nodeKey === WorkerA.key)).toBe(true);
        expect(betaRows.some((r) => r.nodeKey === WorkerA.key)).toBe(true);
      }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(35))),
    60_000,
  );

  it.live(
    "L7: while A is draining for handoff, askIncumbent yield is refused (row held)",
    () =>
      Effect.gen(function* () {
        const lookupPath = yield* tmpSock("l7-lookup");
        const pathA = yield* tmpSock("l7-a");
        const pathPeer = yield* tmpSock("l7-peer");
        const pathNewcomer = yield* tmpSock("l7-new");

        const lookupNode = Node.Tag()("ab/l7-lookup", {
          path: lookupPath,
          onConflict: "askIncumbent",
        }).pipe(Node.asLookup);

        class Mover extends Hyperlink.Tag<Mover>()("ab/l7/Mover", {
          take: Hyperlink.effect(Schema.Array(Schema.String)),
          give: Hyperlink.effectFn(Schema.Array(Schema.String), Schema.Void),
        }) {}

        // Incumbent nodeKey — askIncumbent newcomers collide on this key.
        class WorkerA extends Node.Tag<WorkerA, Mover>()("ab/l7/Worker", {
          path: pathA,
        }) {}
        // Different nodeKey so Directory has a non-self dial for A's handoff fn to enter.
        class Peer extends Node.Tag<Peer, Mover>()("ab/l7/Peer", {
          path: pathPeer,
        }) {}

        const lookupClient = Lookup.client(lookupNode);
        yield* Layer.build(Lookup.layerNode(lookupNode));
        const lookupCtx = yield* Layer.build(lookupClient);

        const storeA = yield* Ref.make<ReadonlyArray<string>>(["held"]);
        const storePeer = yield* Ref.make<ReadonlyArray<string>>([]);
        const handoffEntered = yield* Deferred.make<void>();
        const releaseHandoff = yield* Deferred.make<void>();

        const moverImpl = (store: Ref.Ref<ReadonlyArray<string>>) => ({
          take: Effect.gen(function* () {
            const items = yield* Ref.get(store);
            yield* Ref.set(store, []);
            return items;
          }),
          give: (items: ReadonlyArray<string>) =>
            Ref.update(store, (a) => [...a, ...items]),
        });

        yield* Layer.build(
          Node.unix(Peer, [
            Hyperlink.serve(Mover, moverImpl(storePeer), {
              handoff: () => Effect.void,
            }),
          ]).pipe(Layer.provide(lookupClient)),
        );

        yield* Layer.build(
          Node.unix(
            WorkerA,
            [
              Hyperlink.serve(Mover, moverImpl(storeA), {
                handoff: (
                  from: {
                    readonly take: Effect.Effect<ReadonlyArray<string>>;
                  },
                  to: {
                    readonly give: (
                      items: ReadonlyArray<string>,
                    ) => Effect.Effect<void>;
                  },
                  ctx: Hyperlink.HandoffContext,
                ) =>
                  Effect.gen(function* () {
                    yield* Deferred.succeed(handoffEntered, undefined);
                    yield* Deferred.await(releaseHandoff);
                    const items = yield* from.take;
                    if (items.length > 0) yield* to.give(items);
                    return yield* ctx.done;
                  }),
              }),
            ],
            { onYield: Effect.succeed(true) },
          ).pipe(Layer.provide(lookupClient)),
        );

        yield* waitUntil(
          nodesServing(lookupCtx, Mover.key),
          (rows) => rows.length === 2,
        );

        const shutdownFiber = yield* Effect.forkChild(
          Node.shutdown(WorkerA).pipe(Effect.exit),
        );

        yield* Deferred.await(handoffEntered);

        // Mid-handoff: phase must be draining and yield must refuse.
        const mid = yield* Effect.gen(function* () {
          const status = yield* NodeStatusTag;
          const snapshot = yield* status.status.get;
          const yielded = yield* status.yield;
          return { snapshot, yielded };
        }).pipe(Effect.provide(nodeStatusClient(WorkerA)), Effect.scoped);

        expect(mid.snapshot.phase).toBe("draining");
        expect(mid.yielded).toBe(false);

        const dir = Context.get(lookupCtx, Directory.Tag);
        const conflict = yield* dir
          .advertise(
            new Lookup.AdvertiseRequest({
              nodeKey: WorkerA.key,
              kind: "IpcSocket",
              path: pathNewcomer,
              serves: [Mover.key],
              onConflict: "inherit",
            }),
          )
          .pipe(
            Effect.map((entry) => ({ _tag: "Ok" as const, entry })),
            Effect.catchTag("IncumbentAlive", (error) =>
              Effect.succeed({ _tag: "Alive" as const, error }),
            ),
            Effect.provide(lookupCtx),
          );

        expect(conflict._tag).toBe("Alive");
        if (conflict._tag === "Alive") {
          expect(conflict.error.incumbent.path).toBe(pathA);
        }

        // Incumbent row held at A's dial (peer row may also be present).
        const held = yield* nodesServing(lookupCtx, Mover.key);
        expect(held.some((r) => r.path === pathA)).toBe(true);

        yield* Deferred.succeed(releaseHandoff, undefined);
        const shutExit = yield* Fiber.join(shutdownFiber);
        expect(Exit.isSuccess(shutExit)).toBe(true);
        if (Exit.isFailure(shutExit)) {
          expect.fail(`expected successful leave; got ${String(shutExit.cause)}`);
        }

        yield* waitUntil(
          nodesServing(lookupCtx, Mover.key),
          (rows) => !rows.some((r) => r.nodeKey === WorkerA.key),
        );
        expect(yield* Ref.get(storePeer)).toEqual(["held"]);
      }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(40))),
    60_000,
  );
});

describe("A→B cutover — recovery, defects, multi-peer, mid-flight", () => {
  it.live(
    "L9: void handoff return coerces to Done; A leaves when peer is present",
    () =>
      Effect.gen(function* () {
        const lookupPath = yield* tmpSock("l9-lookup");
        const pathA = yield* tmpSock("l9-a");
        const pathB = yield* tmpSock("l9-b");

        const lookupNode = Node.Tag()("ab/l9-lookup", {
          path: lookupPath,
        }).pipe(Node.asLookup);

        class Ping extends Hyperlink.Tag<Ping>()("ab/l9/Ping", {
          ping: Hyperlink.effect(Schema.Number),
        }) {}
        class WorkerA extends Node.Tag<WorkerA, Ping>()("ab/l9/WorkerA", {
          path: pathA,
        }) {}
        class WorkerB extends Node.Tag<WorkerB, Ping>()("ab/l9/WorkerB", {
          path: pathB,
        }) {}

        const lookupClient = Lookup.client(lookupNode);
        yield* Layer.build(Lookup.layerNode(lookupNode));
        const lookupCtx = yield* Layer.build(lookupClient);
        const ran = yield* Ref.make(false);

        yield* Layer.build(
          Node.unix(WorkerB, [
            Hyperlink.serve(Ping, { ping: Effect.succeed(1) }),
          ]).pipe(Layer.provide(lookupClient)),
        );
        yield* Layer.build(
          Node.unix(WorkerA, [
            Hyperlink.serve(
              Ping,
              { ping: Effect.succeed(0) },
              {
                // Return void Effect (no ctx.done) — runner coerces to Done.
                handoff: () =>
                  Effect.andThen(Ref.set(ran, true), Effect.void),
              },
            ),
          ]).pipe(Layer.provide(lookupClient)),
        );

        yield* waitUntil(
          nodesServing(lookupCtx, Ping.key),
          (rows) => rows.length === 2,
        );

        yield* Node.shutdown(WorkerA);
        expect(yield* Ref.get(ran)).toBe(true);
        yield* waitUntil(
          nodesServing(lookupCtx, Ping.key),
          (rows) =>
            rows.length === 1 && rows[0]?.nodeKey === WorkerB.key,
        );
      }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(30))),
    60_000,
  );

  it.live(
    "L10: defecting handoff ⇒ HandoffDeferred(Failed); phase running; Directory held",
    () =>
      Effect.gen(function* () {
        const lookupPath = yield* tmpSock("l10-lookup");
        const pathA = yield* tmpSock("l10-a");
        const pathB = yield* tmpSock("l10-b");

        const lookupNode = Node.Tag()("ab/l10-lookup", {
          path: lookupPath,
        }).pipe(Node.asLookup);

        class Ping extends Hyperlink.Tag<Ping>()("ab/l10/Ping", {
          ping: Hyperlink.effect(Schema.Number),
        }) {}
        class WorkerA extends Node.Tag<WorkerA, Ping>()("ab/l10/WorkerA", {
          path: pathA,
        }) {}
        class WorkerB extends Node.Tag<WorkerB, Ping>()("ab/l10/WorkerB", {
          path: pathB,
        }) {}

        const lookupClient = Lookup.client(lookupNode);
        yield* Layer.build(Lookup.layerNode(lookupNode));
        const lookupCtx = yield* Layer.build(lookupClient);

        yield* Layer.build(
          Node.unix(WorkerB, [
            Hyperlink.serve(Ping, { ping: Effect.succeed(1) }),
          ]).pipe(Layer.provide(lookupClient)),
        );
        yield* Layer.build(
          Node.unix(WorkerA, [
            Hyperlink.serve(
              Ping,
              { ping: Effect.succeed(0) },
              { handoff: () => Effect.die("handoff-boom") },
            ),
          ]).pipe(Layer.provide(lookupClient)),
        );

        yield* waitUntil(
          nodesServing(lookupCtx, Ping.key),
          (rows) => rows.length === 2,
        );

        const err = yield* Effect.flip(Node.shutdown(WorkerA));
        expectHandoffDeferred(err, {
          reason: "Failed",
          serviceKey: Ping.key,
        });
        expect(yield* nodePhase(WorkerA)).toBe("running");

        const rows = yield* nodesServing(lookupCtx, Ping.key);
        expect(rows.some((r) => r.nodeKey === WorkerA.key)).toBe(true);
      }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(30))),
    60_000,
  );

  it.live("L11: Retry exhausted ⇒ HandoffDeferred(RetryExhausted); A stays", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("l11-lookup");
      const pathA = yield* tmpSock("l11-a");
      const pathB = yield* tmpSock("l11-b");

      const lookupNode = Node.Tag()("ab/l11-lookup", {
        path: lookupPath,
      }).pipe(Node.asLookup);

      class Ping extends Hyperlink.Tag<Ping>()("ab/l11/Ping", {
        ping: Hyperlink.effect(Schema.Number),
      }) {}
      class WorkerA extends Node.Tag<WorkerA, Ping>()("ab/l11/WorkerA", {
        path: pathA,
      }) {}
      class WorkerB extends Node.Tag<WorkerB, Ping>()("ab/l11/WorkerB", {
        path: pathB,
      }) {}

      const lookupClient = Lookup.client(lookupNode);
      yield* Layer.build(Lookup.layerNode(lookupNode));
      const lookupCtx = yield* Layer.build(lookupClient);
      const attempts = yield* Ref.make(0);

      yield* Layer.build(
        Node.unix(WorkerB, [
          Hyperlink.serve(Ping, { ping: Effect.succeed(1) }),
        ]).pipe(Layer.provide(lookupClient)),
      );
      yield* Layer.build(
        Node.unix(WorkerA, [
          Hyperlink.serve(
            Ping,
            { ping: Effect.succeed(0) },
            {
              handoff: (_from, _to, ctx) =>
                Effect.gen(function* () {
                  yield* Ref.update(attempts, (n) => n + 1);
                  return yield* ctx.retry;
                }),
            },
          ),
        ]).pipe(Layer.provide(lookupClient)),
      );

      yield* waitUntil(
        nodesServing(lookupCtx, Ping.key),
        (rows) => rows.length === 2,
      );

      const err = yield* Effect.flip(Node.shutdown(WorkerA));
      expectHandoffDeferred(err, {
        reason: "RetryExhausted",
        serviceKey: Ping.key,
      });
      // Default retries = N ⇒ initial attempt + N retries = N + 1 invocations.
      expect(yield* Ref.get(attempts)).toBe(DEFAULT_HANDOFF_RETRIES + 1);
      expect(yield* nodePhase(WorkerA)).toBe("running");

      const rows = yield* nodesServing(lookupCtx, Ping.key);
      expect(rows.some((r) => r.nodeKey === WorkerA.key)).toBe(true);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(30))),
    60_000,
  );

  it.live(
    "L12: after NoPeer defer, bring B up and retry shutdown ⇒ Done transfer",
    () =>
      Effect.gen(function* () {
        const lookupPath = yield* tmpSock("l12-lookup");
        const pathA = yield* tmpSock("l12-a");
        const pathB = yield* tmpSock("l12-b");

        const lookupNode = Node.Tag()("ab/l12-lookup", {
          path: lookupPath,
        }).pipe(Node.asLookup);

        class Jobs extends WorkPool.Tag<Jobs>()("ab/l12/Jobs", {
          payload: Item,
        }) {}
        class WorkerA extends Node.Tag<WorkerA, Jobs>()("ab/l12/WorkerA", {
          path: pathA,
        }) {}
        class WorkerB extends Node.Tag<WorkerB, Jobs>()("ab/l12/WorkerB", {
          path: pathB,
        }) {}

        const lookupClient = Lookup.client(lookupNode);
        yield* Layer.build(Lookup.layerNode(lookupNode));
        const lookupCtx = yield* Layer.build(lookupClient);

        const aCtx = yield* Layer.build(
          Node.unix(WorkerA, [
            WorkPool.serve(Jobs, { effect: () => Effect.void }).pipe(Hyperlink.deferStart),
          ]).pipe(Layer.provide(lookupClient)),
        );

        yield* Effect.gen(function* () {
          const q = yield* Jobs;
          yield* q.add([{ n: 1 }, { n: 2 }]);
        }).pipe(Effect.provide(aCtx));

        const first = yield* Effect.flip(Node.shutdown(WorkerA));
        expectHandoffDeferred(first, {
          reason: "NoPeer",
          serviceKey: Jobs.key,
        });
        expect(yield* nodePhase(WorkerA)).toBe("running");

        // Pending still on A after restore; latch cleared so a later shutdown can retry.
        const aSnap = yield* Effect.gen(function* () {
          const q = yield* Jobs;
          return yield* q.status.get;
        }).pipe(Effect.provide(aCtx));
        expect(aSnap.sizes.normal).toBe(2);

        yield* Layer.build(
          Node.unix(WorkerB, [
            WorkPool.serve(Jobs, { effect: () => Effect.void }).pipe(Hyperlink.deferStart),
          ]).pipe(Layer.provide(lookupClient)),
        );

        yield* waitUntil(
          nodesServing(lookupCtx, Jobs.key),
          (rows) => rows.length === 2,
        );

        yield* Node.shutdown(WorkerA);

        const bSnap = yield* Effect.gen(function* () {
          const q = yield* Jobs;
          return yield* q.status.get;
        }).pipe(Effect.provide(Hyperlink.client(Jobs, WorkerB)), Effect.scoped);
        expect(bSnap.sizes.normal).toBe(2);
      }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(40))),
  );

  it.live(
    "L4b: peer give fails after local take ⇒ Defer + re-queue; A stays running",
    () =>
      Effect.gen(function* () {
        const lookupPath = yield* tmpSock("l4b-lookup");
        const pathA = yield* tmpSock("l4b-a");
        const pathB = yield* tmpSock("l4b-b");

        const lookupNode = Node.Tag()("ab/l4b-lookup", {
          path: lookupPath,
        }).pipe(Node.asLookup);

        class Mover extends Hyperlink.Tag<Mover>()("ab/l4b/Mover", {
          take: Hyperlink.effect(Schema.Array(Schema.String)),
          give: Hyperlink.effectFn(Schema.Array(Schema.String), Schema.Void),
        }) {}
        class WorkerA extends Node.Tag<WorkerA, Mover>()("ab/l4b/WorkerA", {
          path: pathA,
        }) {}
        class WorkerB extends Node.Tag<WorkerB, Mover>()("ab/l4b/WorkerB", {
          path: pathB,
        }) {}

        const lookupClient = Lookup.client(lookupNode);
        yield* Layer.build(Lookup.layerNode(lookupNode));
        const lookupCtx = yield* Layer.build(lookupClient);

        const storeA = yield* Ref.make<ReadonlyArray<string>>(["keep-me"]);
        const storeB = yield* Ref.make<ReadonlyArray<string>>([]);
        const refuseGive = yield* Ref.make(false);
        const taken = yield* Deferred.make<void>();
        const proceedGive = yield* Deferred.make<void>();

        yield* Layer.build(
          Node.unix(WorkerB, [
            Hyperlink.serve(Mover, {
              take: Effect.gen(function* () {
                const items = yield* Ref.get(storeB);
                yield* Ref.set(storeB, []);
                return items;
              }),
              give: (items: ReadonlyArray<string>) =>
                Effect.gen(function* () {
                  if (yield* Ref.get(refuseGive)) {
                    // Defect — runner folds into HandoffDeferred({ reason: "Failed" }) on A;
                    // here we force the peer RPC to fail mid-handoff.
                    return yield* Effect.die("peer-refusing-give");
                  }
                  yield* Ref.update(storeB, (a) => [...a, ...items]);
                }),
            }),
          ]).pipe(Layer.provide(lookupClient)),
        );

        yield* Layer.build(
          Node.unix(WorkerA, [
            Hyperlink.serve(
              Mover,
              {
                take: Effect.gen(function* () {
                  const items = yield* Ref.get(storeA);
                  yield* Ref.set(storeA, []);
                  return items;
                }),
                give: (items: ReadonlyArray<string>) =>
                  Ref.update(storeA, (a) => [...a, ...items]),
              },
              {
                handoff: (
                  from: {
                    readonly take: Effect.Effect<ReadonlyArray<string>>;
                  },
                  to: {
                    readonly give: (
                      items: ReadonlyArray<string>,
                    ) => Effect.Effect<void>;
                  },
                  ctx: Hyperlink.HandoffContext,
                ) =>
                  Effect.gen(function* () {
                    const items = yield* from.take;
                    if (items.length === 0) return yield* ctx.done;
                    yield* Deferred.succeed(taken, undefined);
                    yield* Deferred.await(proceedGive);
                    const exit = yield* Effect.exit(to.give(items));
                    if (Exit.isFailure(exit)) {
                      yield* Ref.set(storeA, items);
                      return yield* ctx.defer;
                    }
                    return yield* ctx.done;
                  }),
              },
            ),
          ]).pipe(Layer.provide(lookupClient)),
        );

        yield* waitUntil(
          nodesServing(lookupCtx, Mover.key),
          (rows) => rows.length === 2,
        );

        const shutdownFiber = yield* Effect.forkChild(
          Node.shutdown(WorkerA).pipe(Effect.exit),
        );
        yield* Deferred.await(taken);

        // Flip peer to refuse, then let the in-flight give proceed.
        yield* Ref.set(refuseGive, true);
        yield* Deferred.succeed(proceedGive, undefined);

        const shutExit = yield* Fiber.join(shutdownFiber);
        expect(expectTaggedFailure(shutExit, "HandoffDeferred")).toMatchObject({
          _tag: "HandoffDeferred",
          reason: "Defer",
          serviceKey: Mover.key,
        });

        expect(yield* Ref.get(storeA)).toEqual(["keep-me"]);
        expect(yield* Ref.get(storeB)).toEqual([]);
        expect(yield* nodePhase(WorkerA)).toBe("running");
        expect(
          (yield* nodesServing(lookupCtx, Mover.key)).some(
            (r) => r.nodeKey === WorkerA.key,
          ),
        ).toBe(true);
      }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(40))),
    60_000,
  );

  it.live(
    "L13: three Directory peers — A excludes self by dial and transfers to a peer",
    () =>
      Effect.gen(function* () {
        const lookupPath = yield* tmpSock("l13-lookup");
        const pathA = yield* tmpSock("l13-a");
        const pathB = yield* tmpSock("l13-b");
        const pathC = yield* tmpSock("l13-c");

        const lookupNode = Node.Tag()("ab/l13-lookup", {
          path: lookupPath,
        }).pipe(Node.asLookup);

        class Jobs extends WorkPool.Tag<Jobs>()("ab/l13/Jobs", {
          payload: Item,
        }) {}
        class WorkerA extends Node.Tag<WorkerA, Jobs>()("ab/l13/WorkerA", {
          path: pathA,
        }) {}
        class WorkerB extends Node.Tag<WorkerB, Jobs>()("ab/l13/WorkerB", {
          path: pathB,
        }) {}
        class WorkerC extends Node.Tag<WorkerC, Jobs>()("ab/l13/WorkerC", {
          path: pathC,
        }) {}

        const lookupClient = Lookup.client(lookupNode);
        yield* Layer.build(Lookup.layerNode(lookupNode));
        const lookupCtx = yield* Layer.build(lookupClient);

        yield* Layer.build(
          Node.unix(WorkerB, [
            WorkPool.serve(Jobs, { effect: () => Effect.void }).pipe(Hyperlink.deferStart),
          ]).pipe(Layer.provide(lookupClient)),
        );
        yield* Layer.build(
          Node.unix(WorkerC, [
            WorkPool.serve(Jobs, { effect: () => Effect.void }).pipe(Hyperlink.deferStart),
          ]).pipe(Layer.provide(lookupClient)),
        );
        const aCtx = yield* Layer.build(
          Node.unix(WorkerA, [
            WorkPool.serve(Jobs, { effect: () => Effect.void }).pipe(Hyperlink.deferStart),
          ]).pipe(Layer.provide(lookupClient)),
        );

        yield* waitUntil(
          nodesServing(lookupCtx, Jobs.key),
          (rows) => rows.length === 3,
        );

        yield* Effect.gen(function* () {
          const q = yield* Jobs;
          yield* q.add([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }]);
        }).pipe(Effect.provide(aCtx));

        yield* Node.shutdown(WorkerA);

        yield* waitUntil(
          nodesServing(lookupCtx, Jobs.key),
          (rows) => rows.length === 2,
        );

        const bSnap = yield* Effect.gen(function* () {
          const q = yield* Jobs;
          return yield* q.status.get;
        }).pipe(Effect.provide(Hyperlink.client(Jobs, WorkerB)), Effect.scoped);
        const cSnap = yield* Effect.gen(function* () {
          const q = yield* Jobs;
          return yield* q.status.get;
        }).pipe(Effect.provide(Hyperlink.client(Jobs, WorkerC)), Effect.scoped);

        // First non-self Directory row wins; exactly one peer receives all pending.
        expect(bSnap.sizes.normal + cSnap.sizes.normal).toBe(4);
        expect(
          bSnap.sizes.normal === 4 || cSnap.sizes.normal === 4,
        ).toBe(true);
      }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(40))),
  );

  it.live(
    "L14: WorkPool transfer preserves exact pending payloads (not just count)",
    () =>
      Effect.gen(function* () {
        const lookupPath = yield* tmpSock("l14-lookup");
        const pathA = yield* tmpSock("l14-a");
        const pathB = yield* tmpSock("l14-b");

        const lookupNode = Node.Tag()("ab/l14-lookup", {
          path: lookupPath,
        }).pipe(Node.asLookup);

        class Jobs extends WorkPool.Tag<Jobs>()("ab/l14/Jobs", {
          payload: Item,
        }) {}
        class WorkerA extends Node.Tag<WorkerA, Jobs>()("ab/l14/WorkerA", {
          path: pathA,
        }) {}
        class WorkerB extends Node.Tag<WorkerB, Jobs>()("ab/l14/WorkerB", {
          path: pathB,
        }) {}

        const lookupClient = Lookup.client(lookupNode);
        yield* Layer.build(Lookup.layerNode(lookupNode));
        const lookupCtx = yield* Layer.build(lookupClient);

        yield* Layer.build(
          Node.unix(WorkerB, [
            WorkPool.serve(Jobs, { effect: () => Effect.void }).pipe(Hyperlink.deferStart),
          ]).pipe(Layer.provide(lookupClient)),
        );
        const aCtx = yield* Layer.build(
          Node.unix(WorkerA, [
            WorkPool.serve(Jobs, { effect: () => Effect.void }).pipe(Hyperlink.deferStart),
          ]).pipe(Layer.provide(lookupClient)),
        );

        yield* waitUntil(
          nodesServing(lookupCtx, Jobs.key),
          (rows) => rows.length === 2,
        );

        const payloads = [{ n: 101 }, { n: 202 }, { n: 303 }];
        yield* Effect.gen(function* () {
          const q = yield* Jobs;
          yield* q.add(payloads);
        }).pipe(Effect.provide(aCtx));

        yield* Node.shutdown(WorkerA);

        const released = yield* Effect.gen(function* () {
          const q = yield* Jobs;
          return yield* q.release({});
        }).pipe(Effect.provide(Hyperlink.client(Jobs, WorkerB)), Effect.scoped);

        expect(released.map((e) => e.item)).toEqual(payloads);
      }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(35))),
  );

  it.live(
    "L15: custom handoff empty take ⇒ Done without calling peer give",
    () =>
      Effect.gen(function* () {
        const lookupPath = yield* tmpSock("l15-lookup");
        const pathA = yield* tmpSock("l15-a");
        const pathB = yield* tmpSock("l15-b");

        const lookupNode = Node.Tag()("ab/l15-lookup", {
          path: lookupPath,
        }).pipe(Node.asLookup);

        class Mover extends Hyperlink.Tag<Mover>()("ab/l15/Mover", {
          take: Hyperlink.effect(Schema.Array(Schema.String)),
          give: Hyperlink.effectFn(Schema.Array(Schema.String), Schema.Void),
        }) {}
        class WorkerA extends Node.Tag<WorkerA, Mover>()("ab/l15/WorkerA", {
          path: pathA,
        }) {}
        class WorkerB extends Node.Tag<WorkerB, Mover>()("ab/l15/WorkerB", {
          path: pathB,
        }) {}

        const lookupClient = Lookup.client(lookupNode);
        yield* Layer.build(Lookup.layerNode(lookupNode));
        const lookupCtx = yield* Layer.build(lookupClient);

        const giveTouched = yield* Ref.make(false);
        const storeA = yield* Ref.make<ReadonlyArray<string>>([]);
        const storeB = yield* Ref.make<ReadonlyArray<string>>([]);

        yield* Layer.build(
          Node.unix(WorkerB, [
            Hyperlink.serve(Mover, {
              take: Ref.get(storeB),
              give: (items) =>
                Effect.gen(function* () {
                  yield* Ref.set(giveTouched, true);
                  yield* Ref.update(storeB, (a) => [...a, ...items]);
                }),
            }),
          ]).pipe(Layer.provide(lookupClient)),
        );

        yield* Layer.build(
          Node.unix(WorkerA, [
            Hyperlink.serve(
              Mover,
              {
                take: Effect.gen(function* () {
                  const items = yield* Ref.get(storeA);
                  yield* Ref.set(storeA, []);
                  return items;
                }),
                give: (items) => Ref.update(storeA, (a) => [...a, ...items]),
              },
              {
                handoff: (
                  from: {
                    readonly take: Effect.Effect<ReadonlyArray<string>>;
                  },
                  to: {
                    readonly give: (
                      items: ReadonlyArray<string>,
                    ) => Effect.Effect<void>;
                  },
                  ctx: Hyperlink.HandoffContext,
                ) =>
                  Effect.gen(function* () {
                    const items = yield* from.take;
                    if (items.length === 0) return yield* ctx.done;
                    yield* to.give(items);
                    return yield* ctx.done;
                  }),
              },
            ),
          ]).pipe(Layer.provide(lookupClient)),
        );

        yield* waitUntil(
          nodesServing(lookupCtx, Mover.key),
          (rows) => rows.length === 2,
        );

        yield* Node.shutdown(WorkerA);
        expect(yield* Ref.get(giveTouched)).toBe(false);
        yield* waitUntil(
          nodesServing(lookupCtx, Mover.key),
          (rows) =>
            rows.length === 1 && rows[0]?.nodeKey === WorkerB.key,
        );
      }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(30))),
  );

  it.live(
    "L16: same-nodeKey dual-row race — after yield, A handoff still finds B by dial",
    () =>
      Effect.gen(function* () {
        // Stronger than L-same: assert peer dial ≠ A's path and items move once.
        const lookupPath = yield* tmpSock("l16-lookup");
        const pathA = yield* tmpSock("l16-a");
        const pathB = yield* tmpSock("l16-b");

        const lookupNode = Node.Tag()("ab/l16-lookup", {
          path: lookupPath,
          onConflict: "askIncumbent",
        }).pipe(Node.asLookup);

        class Jobs extends WorkPool.Tag<Jobs>()("ab/l16/Jobs", {
          payload: Item,
        }) {}
        class WorkerA extends Node.Tag<WorkerA, Jobs>()("ab/l16/Worker", {
          path: pathA,
        }) {}
        class WorkerB extends Node.Tag<WorkerB, Jobs>()("ab/l16/Worker", {
          path: pathB,
        }) {}

        const lookupClient = Lookup.client(lookupNode);
        yield* Layer.build(Lookup.layerNode(lookupNode));
        const lookupCtx = yield* Layer.build(lookupClient);

        const aCtx = yield* Layer.build(
          Node.unix(
            WorkerA,
            [
              WorkPool.serve(Jobs, { effect: () => Effect.void }).pipe(Hyperlink.deferStart),
            ],
            { onYield: Effect.succeed(true) },
          ).pipe(Layer.provide(lookupClient)),
        );

        yield* Effect.gen(function* () {
          const q = yield* Jobs;
          yield* q.add([{ n: 42 }]);
        }).pipe(Effect.provide(aCtx));

        yield* Layer.build(
          Node.unix(
            WorkerB,
            [
              WorkPool.serve(Jobs, { effect: () => Effect.void }).pipe(Hyperlink.deferStart),
            ],
            { onConflict: "inherit" },
          ).pipe(Layer.provide(lookupClient)),
        );

        const row = yield* waitUntil(
          nodesServing(lookupCtx, Jobs.key),
          (rows) => {
            const r = rows.find((x) => x.nodeKey === WorkerA.key);
            return r !== undefined && r.path === pathB;
          },
        );
        expect(row[0]?.path).toBe(pathB);
        expect(row[0]?.path).not.toBe(pathA);

        yield* Node.shutdown(WorkerA);

        const bSnap = yield* Effect.gen(function* () {
          const q = yield* Jobs;
          return yield* q.status.get;
        }).pipe(Effect.provide(Hyperlink.client(Jobs, WorkerB)), Effect.scoped);
        expect(bSnap.sizes.normal).toBe(1);

        // Unregister by A's dial must not erase B.
        expect(yield* nodesServing(lookupCtx, Jobs.key)).toHaveLength(1);
        expect((yield* nodesServing(lookupCtx, Jobs.key))[0]?.path).toBe(
          pathB,
        );
      }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(40))),
  );
});

describe("A→B cutover — peer identity, dual Done, Advice, serveRemote", () => {
  it.live(
    "L17: handoff `to` is the Directory peer (B), not self — proven via snapshot id",
    () =>
      Effect.gen(function* () {
        const lookupPath = yield* tmpSock("l17-lookup");
        const pathA = yield* tmpSock("l17-a");
        const pathB = yield* tmpSock("l17-b");

        const lookupNode = Node.Tag()("ab/l17-lookup", {
          path: lookupPath,
        }).pipe(Node.asLookup);

        class Mover extends Hyperlink.Tag<Mover>()("ab/l17/Mover", {
          take: Hyperlink.effect(Schema.Array(Schema.String)),
          give: Hyperlink.effectFn(Schema.Array(Schema.String), Schema.Void),
          whoami: Hyperlink.effect(Schema.String),
        }) {}
        class WorkerA extends Node.Tag<WorkerA, Mover>()("ab/l17/WorkerA", {
          path: pathA,
        }) {}
        class WorkerB extends Node.Tag<WorkerB, Mover>()("ab/l17/WorkerB", {
          path: pathB,
        }) {}

        const lookupClient = Lookup.client(lookupNode);
        yield* Layer.build(Lookup.layerNode(lookupNode));
        const lookupCtx = yield* Layer.build(lookupClient);

        const storeA = yield* Ref.make<ReadonlyArray<string>>(["x"]);
        const storeB = yield* Ref.make<ReadonlyArray<string>>([]);
        const peeredAs = yield* Ref.make<Option.Option<string>>(Option.none());

        const impl = (
          id: string,
          store: Ref.Ref<ReadonlyArray<string>>,
        ) => ({
          take: Effect.gen(function* () {
            const items = yield* Ref.get(store);
            yield* Ref.set(store, []);
            return items;
          }),
          give: (items: ReadonlyArray<string>) =>
            Ref.update(store, (a) => [...a, ...items]),
          whoami: Effect.succeed(id),
        });

        const handoff = (
          from: {
            readonly take: Effect.Effect<ReadonlyArray<string>>;
          },
          to: {
            readonly give: (
              items: ReadonlyArray<string>,
            ) => Effect.Effect<void>;
            readonly whoami: Effect.Effect<string>;
          },
          ctx: Hyperlink.HandoffContext,
        ) =>
          Effect.gen(function* () {
            yield* Ref.set(peeredAs, Option.some(yield* to.whoami));
            const items = yield* from.take;
            if (items.length > 0) yield* to.give(items);
            return yield* ctx.done;
          });

        yield* Layer.build(
          Node.unix(WorkerB, [
            Hyperlink.serve(Mover, impl("B", storeB), { handoff }),
          ]).pipe(Layer.provide(lookupClient)),
        );
        yield* Layer.build(
          Node.unix(WorkerA, [
            Hyperlink.serve(Mover, impl("A", storeA), { handoff }),
          ]).pipe(Layer.provide(lookupClient)),
        );

        yield* waitUntil(
          nodesServing(lookupCtx, Mover.key),
          (rows) => rows.length === 2,
        );

        yield* Node.shutdown(WorkerA);

        expect(yield* Ref.get(peeredAs)).toEqual(Option.some("B"));
        expect(yield* Ref.get(storeB)).toEqual(["x"]);
        expect(yield* Ref.get(storeA)).toEqual([]);
      }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(30))),
    60_000,
  );

  it.live(
    "L18: two services both Done ⇒ both transfer; A leaves Directory for both keys",
    () =>
      Effect.gen(function* () {
        const lookupPath = yield* tmpSock("l18-lookup");
        const pathA = yield* tmpSock("l18-a");
        const pathB = yield* tmpSock("l18-b");

        const lookupNode = Node.Tag()("ab/l18-lookup", {
          path: lookupPath,
        }).pipe(Node.asLookup);

        class Alpha extends Hyperlink.Tag<Alpha>()("ab/l18/Alpha", {
          take: Hyperlink.effect(Schema.Array(Schema.String)),
          give: Hyperlink.effectFn(Schema.Array(Schema.String), Schema.Void),
        }) {}
        class Beta extends Hyperlink.Tag<Beta>()("ab/l18/Beta", {
          take: Hyperlink.effect(Schema.Array(Schema.String)),
          give: Hyperlink.effectFn(Schema.Array(Schema.String), Schema.Void),
        }) {}

        class WorkerA extends Node.Tag<WorkerA, Alpha | Beta>()(
          "ab/l18/WorkerA",
          { path: pathA },
        ) {}
        class WorkerB extends Node.Tag<WorkerB, Alpha | Beta>()(
          "ab/l18/WorkerB",
          { path: pathB },
        ) {}

        const lookupClient = Lookup.client(lookupNode);
        yield* Layer.build(Lookup.layerNode(lookupNode));
        const lookupCtx = yield* Layer.build(lookupClient);

        const alphaA = yield* Ref.make<ReadonlyArray<string>>(["a1"]);
        const alphaB = yield* Ref.make<ReadonlyArray<string>>([]);
        const betaA = yield* Ref.make<ReadonlyArray<string>>(["b1"]);
        const betaB = yield* Ref.make<ReadonlyArray<string>>([]);

        const bag = (store: Ref.Ref<ReadonlyArray<string>>) => ({
          take: Effect.gen(function* () {
            const items = yield* Ref.get(store);
            yield* Ref.set(store, []);
            return items;
          }),
          give: (items: ReadonlyArray<string>) =>
            Ref.update(store, (a) => [...a, ...items]),
        });

        const move = (
          from: { readonly take: Effect.Effect<ReadonlyArray<string>> },
          to: {
            readonly give: (
              items: ReadonlyArray<string>,
            ) => Effect.Effect<void>;
          },
          ctx: Hyperlink.HandoffContext,
        ) =>
          Effect.gen(function* () {
            const items = yield* from.take;
            if (items.length > 0) yield* to.give(items);
            return yield* ctx.done;
          });

        yield* Layer.build(
          Node.unix(WorkerB, [
            Hyperlink.serve(Alpha, bag(alphaB), { handoff: move }),
            Hyperlink.serve(Beta, bag(betaB), { handoff: move }),
          ]).pipe(Layer.provide(lookupClient)),
        );
        yield* Layer.build(
          Node.unix(WorkerA, [
            Hyperlink.serve(Alpha, bag(alphaA), { handoff: move }),
            Hyperlink.serve(Beta, bag(betaA), { handoff: move }),
          ]).pipe(Layer.provide(lookupClient)),
        );

        yield* waitUntil(
          nodesServing(lookupCtx, Alpha.key),
          (rows) => rows.length === 2,
        );

        yield* Node.shutdown(WorkerA);

        expect(yield* Ref.get(alphaB)).toEqual(["a1"]);
        expect(yield* Ref.get(betaB)).toEqual(["b1"]);
        expect(yield* Ref.get(alphaA)).toEqual([]);
        expect(yield* Ref.get(betaA)).toEqual([]);

        yield* waitUntil(
          nodesServing(lookupCtx, Alpha.key),
          (rows) =>
            rows.length === 1 && rows[0]?.nodeKey === WorkerB.key,
        );
        yield* waitUntil(
          nodesServing(lookupCtx, Beta.key),
          (rows) =>
            rows.length === 1 && rows[0]?.nodeKey === WorkerB.key,
        );
      }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(35))),
    60_000,
  );

  it.live(
    "L19: successful leave clears Advice prefer for the outgoing node's services",
    () =>
      Effect.gen(function* () {
        const lookupPath = yield* tmpSock("l19-lookup");
        const pathA = yield* tmpSock("l19-a");
        const pathB = yield* tmpSock("l19-b");

        const lookupNode = Node.Tag()("ab/l19-lookup", {
          path: lookupPath,
        }).pipe(Node.asLookup);

        class Jobs extends WorkPool.Tag<Jobs>()("ab/l19/Jobs", {
          payload: Item,
        }) {}
        class WorkerA extends Node.Tag<WorkerA, Jobs>()("ab/l19/WorkerA", {
          path: pathA,
        }) {}
        class WorkerB extends Node.Tag<WorkerB, Jobs>()("ab/l19/WorkerB", {
          path: pathB,
        }) {}

        const lookupClient = Lookup.client(lookupNode);
        yield* Layer.build(Lookup.layerNode(lookupNode));
        const lookupCtx = yield* Layer.build(lookupClient);

        yield* Layer.build(
          Node.unix(WorkerB, [
            WorkPool.serve(Jobs, { effect: () => Effect.void }).pipe(Hyperlink.deferStart),
          ]).pipe(Layer.provide(lookupClient)),
        );
        const aCtx = yield* Layer.build(
          Node.unix(WorkerA, [
            WorkPool.serve(Jobs, { effect: () => Effect.void }).pipe(Hyperlink.deferStart),
          ]).pipe(Layer.provide(lookupClient)),
        );

        yield* waitUntil(
          nodesServing(lookupCtx, Jobs.key),
          (rows) => rows.length === 2,
        );

        yield* Effect.gen(function* () {
          const q = yield* Jobs;
          yield* q.add([{ n: 1 }]);
        }).pipe(Effect.provide(aCtx));

        yield* Lookup.advise({
          serviceKey: Jobs.key,
          prefer: WorkerA.key,
        }).pipe(Effect.provide(lookupCtx));

        expect(
          yield* Lookup.preferred(Jobs.key).pipe(Effect.provide(lookupCtx)),
        ).toEqual(Option.some(WorkerA.key));

        yield* Node.shutdown(WorkerA);

        yield* waitUntil(
          Lookup.preferred(Jobs.key).pipe(Effect.provide(lookupCtx)),
          Option.isNone,
        );

        const bSnap = yield* Effect.gen(function* () {
          const q = yield* Jobs;
          return yield* q.status.get;
        }).pipe(Effect.provide(Hyperlink.client(Jobs, WorkerB)), Effect.scoped);
        expect(bSnap.sizes.normal).toBe(1);
      }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(35))),
    60_000,
  );

  it.live(
    "L20: WorkPool.serveRemote bakes releaseEnqueueHandoff (no local grant on A)",
    () =>
      Effect.gen(function* () {
        const lookupPath = yield* tmpSock("l20-lookup");
        const pathA = yield* tmpSock("l20-a");
        const pathB = yield* tmpSock("l20-b");

        const lookupNode = Node.Tag()("ab/l20-lookup", {
          path: lookupPath,
        }).pipe(Node.asLookup);

        class Jobs extends WorkPool.Tag<Jobs>()("ab/l20/Jobs", {
          payload: Item,
        }) {}
        // No Jobs catalog on A — serveRemote grants handlers only (not `yield* Jobs`).
        class WorkerA extends Node.Tag<WorkerA>()("ab/l20/WorkerA", {
          path: pathA,
        }) {}
        class WorkerB extends Node.Tag<WorkerB, Jobs>()("ab/l20/WorkerB", {
          path: pathB,
        }) {}

        const lookupClient = Lookup.client(lookupNode);
        yield* Layer.build(Lookup.layerNode(lookupNode));
        const lookupCtx = yield* Layer.build(lookupClient);

        // B keeps a local grant so we can observe pending after transfer.
        yield* Layer.build(
          Node.unix(WorkerB, [
            WorkPool.serve(Jobs, { effect: () => Effect.void }).pipe(Hyperlink.deferStart),
          ]).pipe(Layer.provide(lookupClient)),
        );
        // A is served-only (gateway) — enqueue via addressed client.
        yield* Layer.build(
          Node.unix(WorkerA, [
            WorkPool.serveRemote(Jobs, { effect: () => Effect.void }).pipe(Hyperlink.deferStart),
          ]).pipe(Layer.provide(lookupClient)),
        );

        yield* waitUntil(
          nodesServing(lookupCtx, Jobs.key),
          (rows) => rows.length === 2,
        );

        yield* Effect.gen(function* () {
          const q = yield* Jobs;
          yield* q.add([{ n: 9 }, { n: 8 }]);
        }).pipe(Effect.provide(Hyperlink.client(Jobs, WorkerA)), Effect.scoped);

        yield* Node.shutdown(WorkerA);

        yield* waitUntil(
          nodesServing(lookupCtx, Jobs.key),
          (rows) =>
            rows.length === 1 && rows[0]?.nodeKey === WorkerB.key,
        );

        const bSnap = yield* Effect.gen(function* () {
          const q = yield* Jobs;
          return yield* q.status.get;
        }).pipe(Effect.provide(Hyperlink.client(Jobs, WorkerB)), Effect.scoped);
        expect(bSnap.sizes.normal).toBe(2);
      }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(35))),
    60_000,
  );
});

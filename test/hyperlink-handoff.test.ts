/**
 * Locked #39 — serve-site `{ handoff }` fn + outcomes (`Done` | `Retry` | `Defer`) + the
 * OUTGOING-node `Node.shutdown` orchestration (run after drain; defer keeps the node up).
 */
import {
  Clock,
  Duration,
  Effect,
  Exit,
  Layer,
  Option,
  Predicate,
  Ref,
  Schema,
} from "effect";
import { describe, expect, it } from "@effect/vitest";
import * as Hyperlink from "../src/Hyperlink";
import * as Lookup from "../src/Lookup";
import * as Node from "../src/Node";
import * as WorkPool from "../src/WorkPool";
import {
  DEFAULT_HANDOFF_RETRIES,
  hyperlinkHandoffContext,
  runHandoffFunction,
} from "../src/internal/hyperlinkHandoff";
import { buildNodeStatusImpl } from "../src/internal/nodeStatus";

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/hyperlink-ts-handoff-${label}-${process.pid}-${now}.sock`;
  });

describe("handoff outcomes + context", () => {
  it("handoffContext yields the tagged outcomes", () =>
    Effect.runSync(
      Effect.gen(function* () {
        expect((yield* hyperlinkHandoffContext.done)._tag).toBe("Done");
        expect((yield* hyperlinkHandoffContext.retry)._tag).toBe("Retry");
        expect((yield* hyperlinkHandoffContext.defer)._tag).toBe("Defer");
      }),
    ));
});

describe("runHandoffFunction", () => {
  it.effect("void return coerces to Done and succeeds (peer present)", () =>
    Effect.gen(function* () {
      const events = yield* Ref.make<Array<string>>([]);
      yield* runHandoffFunction({
        handoff: () => Ref.update(events, (a) => [...a, "ran"]),
        from: {},
        serviceKey: "svc",
        dialPeer: Effect.succeed(Option.some({})),
      });
      expect(yield* Ref.get(events)).toEqual(["ran"]);
    }),
  );

  it.effect("explicit ctx.done succeeds", () =>
    runHandoffFunction({
      handoff: (_from, _to, ctx) => ctx.done,
      from: {},
      serviceKey: "svc",
      dialPeer: Effect.succeed(Option.some({})),
    }),
  );

  it.effect("no peer defers (HandoffDeferred reason=NoPeer)", () =>
    Effect.gen(function* () {
      const err = yield* Effect.flip(
        runHandoffFunction({
          handoff: () => Effect.void,
          from: {},
          serviceKey: "svc",
          dialPeer: Effect.succeed(Option.none()),
        }),
      );
      expect(err._tag).toBe("HandoffDeferred");
      expect(err.reason).toBe("NoPeer");
      expect(err.serviceKey).toBe("svc");
    }),
  );

  it.effect("ctx.defer defers (reason=Defer)", () =>
    Effect.gen(function* () {
      const err = yield* Effect.flip(
        runHandoffFunction({
          handoff: (_from, _to, ctx) => ctx.defer,
          from: {},
          serviceKey: "svc",
          dialPeer: Effect.succeed(Option.some({})),
        }),
      );
      expect(err._tag).toBe("HandoffDeferred");
      expect(err.reason).toBe("Defer");
    }),
  );

  it.effect("Retry re-runs the handoff up to the bound, then succeeds", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0);
      yield* runHandoffFunction({
        handoff: (_from, _to, ctx) =>
          Effect.gen(function* () {
            const n = yield* Ref.updateAndGet(attempts, (x) => x + 1);
            return yield* n < 3 ? ctx.retry : ctx.done;
          }),
        from: {},
        serviceKey: "svc",
        dialPeer: Effect.succeed(Option.some({})),
        retries: 5,
      });
      expect(yield* Ref.get(attempts)).toBe(3);
    }),
  );

  it.effect("Retry exhausted defers (reason=RetryExhausted)", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0);
      const err = yield* Effect.flip(
        runHandoffFunction({
          handoff: (_from, _to, ctx) =>
            Effect.gen(function* () {
              yield* Ref.update(attempts, (n) => n + 1);
              return yield* ctx.retry;
            }),
          from: {},
          serviceKey: "svc",
          dialPeer: Effect.succeed(Option.some({})),
          retries: 2,
        }),
      );
      expect(err._tag).toBe("HandoffDeferred");
      expect(err.reason).toBe("RetryExhausted");
      expect(err.serviceKey).toBe("svc");
      // retries: 2 ⇒ initial + 2 retries = 3 invocations.
      expect(yield* Ref.get(attempts)).toBe(3);
    }),
  );

  it.effect("default retry bound is DEFAULT_HANDOFF_RETRIES", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0);
      const err = yield* Effect.flip(
        runHandoffFunction({
          handoff: (_from, _to, ctx) =>
            Effect.gen(function* () {
              yield* Ref.update(attempts, (n) => n + 1);
              return yield* ctx.retry;
            }),
          from: {},
          serviceKey: "svc",
          dialPeer: Effect.succeed(Option.some({})),
        }),
      );
      expect(err._tag).toBe("HandoffDeferred");
      expect(err.reason).toBe("RetryExhausted");
      expect(yield* Ref.get(attempts)).toBe(DEFAULT_HANDOFF_RETRIES + 1);
    }),
  );

  it.effect("a failing/defecting handoff defers (reason=Failed)", () =>
    Effect.gen(function* () {
      const err = yield* Effect.flip(
        runHandoffFunction({
          handoff: () => Effect.die("boom"),
          from: {},
          serviceKey: "svc",
          dialPeer: Effect.succeed(Option.some({})),
        }),
      );
      expect(err._tag).toBe("HandoffDeferred");
      expect(err.reason).toBe("Failed");
    }),
  );
});

describe("WorkPool.releaseEnqueueHandoff", () => {
  it.effect("releases local entries and enqueues them on the peer", () =>
    Effect.gen(function* () {
      const released = yield* Ref.make<ReadonlyArray<unknown>>([{ id: "a" }]);
      const enqueued = yield* Ref.make<ReadonlyArray<unknown>>([]);
      const from = {
        release: (_input: { readonly options?: unknown }) =>
          Effect.gen(function* () {
            const items = yield* Ref.get(released);
            yield* Ref.set(released, []);
            return items;
          }),
      };
      const to = {
        enqueue: (entries: ReadonlyArray<unknown>) =>
          Ref.set(enqueued, entries),
      };
      yield* runHandoffFunction({
        handoff: WorkPool.releaseEnqueueHandoff,
        from,
        serviceKey: "queue",
        dialPeer: Effect.succeed(Option.some(to)),
      });
      expect(yield* Ref.get(enqueued)).toEqual([{ id: "a" }]);
      expect(yield* Ref.get(released)).toEqual([]);
    }),
  );

  it.effect("nothing to release ⇒ Done without touching the peer", () =>
    Effect.gen(function* () {
      const touched = yield* Ref.make(false);
      const from = {
        release: (_input: { readonly options?: unknown }) =>
          Effect.succeed([] as ReadonlyArray<unknown>),
      };
      const to = {
        enqueue: (_entries: ReadonlyArray<unknown>) => Ref.set(touched, true),
      };
      yield* runHandoffFunction({
        handoff: WorkPool.releaseEnqueueHandoff,
        from,
        serviceKey: "queue",
        dialPeer: Effect.succeed(Option.some(to)),
      });
      expect(yield* Ref.get(touched)).toBe(false);
    }),
  );
});

describe("Node.shutdown handoff orchestration", () => {
  it.effect("runs handoff after drain, before closeListen (happy path)", () =>
    Effect.gen(function* () {
      const order = yield* Ref.make<Array<string>>([]);
      const impl = yield* buildNodeStatusImpl({
        startedAt: 0,
        serviceCount: 1,
        handoff: Ref.update(order, (a) => [...a, "handoff"]),
        closeListen: Ref.update(order, (a) => [...a, "close"]),
      });
      yield* impl.shutdown;
      expect(yield* Ref.get(order)).toEqual(["handoff", "close"]);
      expect((yield* impl.status.get).phase).toBe("draining");
    }),
  );

  it.effect("a deferred handoff restores phase=running and does not close", () =>
    Effect.gen(function* () {
      const order = yield* Ref.make<Array<string>>([]);
      const impl = yield* buildNodeStatusImpl({
        startedAt: 0,
        serviceCount: 1,
        handoff: new Hyperlink.HandoffDeferred({
          serviceKey: "svc",
          reason: "Defer",
        }),
        closeListen: Ref.update(order, (a) => [...a, "close"]),
      });
      const exit = yield* Effect.exit(impl.shutdown);
      expect(Exit.isFailure(exit)).toBe(true);
      // Node stays up: phase back to running, listen not closed, latch cleared (a retry can re-enter).
      expect((yield* impl.status.get).phase).toBe("running");
      expect(yield* Ref.get(order)).toEqual([]);
      const retry = yield* Effect.exit(impl.shutdown);
      expect(Exit.isFailure(retry)).toBe(true);
    }),
  );
});

describe("Node.shutdown end-to-end (Locked #39)", () => {
  it.live("a served { handoff } with no peer defers — the node stays up", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("lookup");
      const workerPath = yield* tmpSock("worker");

      const lookupNode = Node.Tag()("handoff/lookup2", {
        path: lookupPath,
      }).pipe(Node.asLookup);

      class Mover extends Hyperlink.Tag<Mover>()("handoff/Mover", {
        take: Hyperlink.effect(Schema.Array(Schema.String)),
        give: Hyperlink.effectFn(Schema.Array(Schema.String), Schema.Void),
      }) {}

      class Worker extends Node.Tag<Worker, Mover>()("handoff/Worker2", {
        path: workerPath,
      }) {}

      yield* Layer.build(Lookup.layerNode(lookupNode));
      const store = yield* Ref.make<ReadonlyArray<string>>(["job-1"]);

      yield* Layer.build(
        Node.unix(Worker, [
          Hyperlink.serve(
            Mover,
            {
              take: Effect.gen(function* () {
                const items = yield* Ref.get(store);
                yield* Ref.set(store, []);
                return items;
              }),
              give: (items: ReadonlyArray<string>) =>
                Ref.update(store, (a) => [...a, ...items]),
            },
            {
              handoff: (
                from: { readonly take: Effect.Effect<ReadonlyArray<string>> },
                to: {
                  readonly give: (
                    items: ReadonlyArray<string>,
                  ) => Effect.Effect<void>;
                },
                ctx,
              ) =>
                Effect.gen(function* () {
                  const items = yield* from.take;
                  if (items.length === 0) return yield* ctx.done;
                  yield* to.give(items);
                  return yield* ctx.done;
                }),
            },
          ),
        ]).pipe(Layer.provide(Lookup.client(lookupNode))),
      );

      // Only one node serves Mover, so there is no peer to hand off to ⇒ NoPeer (node stays up).
      const err = yield* Effect.flip(Node.shutdown(Worker));
      expect(Predicate.isTagged(err, "HandoffDeferred")).toBe(true);
      if (!Predicate.isTagged(err, "HandoffDeferred")) {
        throw new Error(`expected HandoffDeferred, got ${err._tag}`);
      }
      expect(err.reason).toBe("NoPeer");
      expect(err.serviceKey).toBe(Mover.key);
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
  );
});

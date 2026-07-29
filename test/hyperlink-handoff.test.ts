/**
 * Locked #33 — `Hyperlink.withHandoff` stamp + Node.shutdown handoff hook.
 */
import {
  Clock,
  Duration,
  Effect,
  Layer,
  Ref,
  Schema,
  SubscriptionRef,
} from "effect";
import { describe, expect, it } from "@effect/vitest";
import * as Hyperlink from "../src/Hyperlink";
import * as Lookup from "../src/Lookup";
import * as Node from "../src/Node";
import { makeHyperlinkHandoffRun } from "../src/internal/hyperlinkHandoff";
import { buildNodeStatusImpl } from "../src/internal/nodeStatus";

class Bare extends Hyperlink.Tag<Bare>()("handoff/Bare", {
  ping: Hyperlink.effect(Schema.String),
}) {}

class DrainJobs extends Hyperlink.Tag<DrainJobs>()(
  "handoff/DrainJobs",
  {
    ping: Hyperlink.effect(Schema.String),
  },
  { kind: "hyperlink-ts/WorkPool" },
).pipe(Hyperlink.withHandoff("drainOnly")) {}

class ReleaseJobs extends Hyperlink.Tag<ReleaseJobs>()(
  "handoff/ReleaseJobs",
  {
    ping: Hyperlink.effect(Schema.String),
  },
  { kind: "hyperlink-ts/WorkPool" },
).pipe(Hyperlink.withHandoff("workPoolRelease")) {}

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/hyperlink-ts-handoff-${label}-${process.pid}-${now}.sock`;
  });

describe("Hyperlink.withHandoff", () => {
  it("defaults off and stamps strategies", () => {
    expect(Hyperlink.handoffOf(Bare)).toBeUndefined();
    expect(Hyperlink.handoffOf(DrainJobs)).toBe("drainOnly");
    expect(Hyperlink.handoffOf(ReleaseJobs)).toBe("workPoolRelease");
  });

  it("data-first withHandoff stamps the tag", () => {
    const stamped = Hyperlink.withHandoff(Bare, "drainOnly");
    expect(Hyperlink.handoffOf(stamped)).toBe("drainOnly");
  });

  it.effect("drainOnly shuts down WorkPool-shaped impls", () =>
    Effect.gen(function* () {
      const events = yield* Ref.make<Array<string>>([]);
      const phase = yield* Ref.make("running");
      yield* makeHyperlinkHandoffRun("drainOnly", "hyperlink-ts/WorkPool", {
        shutdown: Effect.gen(function* () {
          yield* Ref.update(events, (a) => [...a, "shutdown"]);
          yield* Ref.set(phase, "off");
        }),
        status: {
          get: Ref.get(phase).pipe(Effect.map((p) => ({ phase: p }))),
        },
      });
      expect(yield* Ref.get(events)).toEqual(["shutdown"]);
      expect(yield* Ref.get(phase)).toBe("off");
    }),
  );

  it.effect("workPoolRelease releases then shuts down", () =>
    Effect.gen(function* () {
      const events = yield* Ref.make<Array<string>>([]);
      const phase = yield* Ref.make("running");
      yield* makeHyperlinkHandoffRun("workPoolRelease", "hyperlink-ts/WorkPool", {
        releaseEncoded: () =>
          Effect.gen(function* () {
            yield* Ref.update(events, (a) => [...a, "releaseEncoded"]);
            return [];
          }),
        shutdown: Effect.gen(function* () {
          yield* Ref.update(events, (a) => [...a, "shutdown"]);
          yield* Ref.set(phase, "off");
        }),
        status: {
          get: Ref.get(phase).pipe(Effect.map((p) => ({ phase: p }))),
        },
      });
      expect(yield* Ref.get(events)).toEqual(["releaseEncoded", "shutdown"]);
    }),
  );

  it.effect("non-WorkPool kinds no-op", () =>
    Effect.gen(function* () {
      const events = yield* Ref.make<Array<string>>([]);
      yield* makeHyperlinkHandoffRun("drainOnly", "hyperlink", {
        shutdown: Ref.update(events, (a) => [...a, "shutdown"]),
      });
      expect(yield* Ref.get(events)).toEqual([]);
    }),
  );

  it.effect("Node.shutdown runs handoff after drain before closeListen", () =>
    Effect.gen(function* () {
      const order = yield* Ref.make<Array<string>>([]);
      const impl = yield* buildNodeStatusImpl({
        startedAt: 0,
        serviceCount: 1,
        handoff: Ref.update(order, (a) => [...a, "handoff"]),
        closeListen: Ref.update(order, (a) => [...a, "close"]),
      });
      yield* impl.shutdown;
      const seen = yield* Ref.get(order);
      expect(seen).toEqual(["handoff", "close"]);
    }),
  );

  it.live("Node.shutdown invokes served drainOnly handoff", () =>
    Effect.gen(function* () {
      const lookupPath = yield* tmpSock("lookup");
      const workerPath = yield* tmpSock("worker");
      const events = yield* Ref.make<Array<string>>([]);

      const lookupNode = Node.Tag()("handoff/lookup", {
        path: lookupPath,
      }).pipe(Node.asLookup);

      class Queue extends Hyperlink.Tag<Queue>()(
        "handoff/IntQueue",
        {
          shutdown: Hyperlink.effect(Schema.Void),
          status: Hyperlink.ref(Schema.Struct({ phase: Schema.String })),
        },
        { kind: "hyperlink-ts/WorkPool" },
      ).pipe(Hyperlink.withHandoff("drainOnly")) {}

      class Worker extends Node.Tag<Worker, Queue>()("handoff/Worker", {
        path: workerPath,
      }) {}

      yield* Layer.build(Lookup.layerNode(lookupNode));
      const status = yield* SubscriptionRef.make({ phase: "running" });

      yield* Layer.build(
        Node.unix(Worker, [
          Hyperlink.serve(Queue, {
            shutdown: Effect.gen(function* () {
              yield* Ref.update(events, (a) => [...a, "shutdown"]);
              yield* SubscriptionRef.set(status, { phase: "off" });
            }),
            status: Hyperlink.subscribable(status),
          }),
        ]).pipe(Layer.provide(Lookup.client(lookupNode))),
      );

      yield* Node.shutdown(Worker);
      yield* Effect.sleep(Duration.millis(200));
      expect(yield* Ref.get(events)).toEqual(["shutdown"]);
      expect((yield* SubscriptionRef.get(status)).phase).toBe("off");
    }).pipe(Effect.scoped, Effect.timeout(Duration.seconds(20))),
  );
});

import { describe, expect, it } from "@effect/vitest";
import { DateTime, Duration, Effect, Ref, Schema, Stream } from "effect";
import * as WorkPool from "../src/WorkPool";
import * as Store from "../src/Store";

// Phase 4 — the queue Tag's `success` schema slot drives the worker's `effect` return type, and that
// typed value flows onto `Completed.success`, `store.completed`, and the analytics reads. A queue
// with NO success schema keeps the historic `void` success channel.

const jobSchema = Schema.Struct({ id: Schema.String });

// ── queue WITH a success schema ──────────────────────────────────────────────
class Doubler extends WorkPool.Service<Doubler>()("@test/Doubler", {
  payload: jobSchema,
  success: Schema.Number,
}) {}

// The worker returns the typed success value (`Effect<number, …>`), driven by `success: Schema.Number`.
const doublerLayer = WorkPool.layerMemory(Doubler, {
  effect: (job) => Effect.succeed(job.id.length * 2),
  concurrency: 1,
});

// ── queue WITHOUT a success schema (historic void channel) ───────────────────
class Sink extends WorkPool.Service<Sink>()("@test/Sink", { payload: jobSchema }) {}
const sinkLayer = WorkPool.layerMemory(Sink, {
  effect: (_job) => Effect.void,
  concurrency: 1,
});

// ── store round-trip for the success value ───────────────────────────────────
const doublerStore = WorkPool.store(Doubler);
class DoublerStore extends Store.Service<DoublerStore>("@test/DoublerStore")(
  doublerStore,
) {}

const t0 = 1_700_000_000_000;
const entry = (id: string) => ({
  item: { id },
  entryId: id,
  priority: "normal" as const,
  attempts: 1,
  timestamps: { enqueuedAt: DateTime.makeUnsafe(t0) },
});

describe("WorkPool — success-value channel", () => {
  it.live(
    "a success-schema worker records its typed value on Completed.success",
    () =>
      Effect.gen(function* () {
        const q = yield* Doubler;
        const seen = yield* Ref.make<ReadonlyArray<unknown>>([]);
        yield* Stream.runForEach(q.events, (e) =>
          e._tag === "Completed"
            ? Ref.update(seen, (a) => [...a, e.success])
            : Effect.void,
        ).pipe(Effect.forkScoped);
        yield* Effect.sleep("20 millis");
        yield* q.add({ id: "abcd" }); // 4 chars → 8
        yield* q.add({ id: "xy" }); //   2 chars → 4
        yield* Effect.sleep("120 millis");
        const values = yield* Ref.get(seen);
        expect([...values].sort()).toEqual([4, 8]);
      }).pipe(Effect.scoped, Effect.provide(doublerLayer)),
  );

  it.live("a queue without a success schema keeps a void worker", () =>
    Effect.gen(function* () {
      const q = yield* Sink;
      const completed = yield* Ref.make(0);
      yield* Stream.runForEach(q.events, (e) =>
        e._tag === "Completed"
          ? Ref.update(completed, (n) => n + 1)
          : Effect.void,
      ).pipe(Effect.forkScoped);
      yield* Effect.sleep("20 millis");
      yield* q.add({ id: "one" });
      yield* Effect.sleep("120 millis");
      expect(yield* Ref.get(completed)).toBe(1);
    }).pipe(Effect.scoped, Effect.provide(sinkLayer)),
  );

  it.effect(
    "the store's Completed record + slowest() round-trip the typed success value",
    () =>
      Effect.gen(function* () {
        const store = yield* DoublerStore;
        // Seed two Completed events carrying the success value; the analytics `slowest` hands back
        // `Completed` events whose `success` is the tag's typed success value (`number`).
        yield* store.record({
          _tag: "Completed",
          entry: entry("a"),
          success: 8,
          elapsed: Duration.millis(100),
        });
        yield* store.record({
          _tag: "Completed",
          entry: entry("b"),
          success: 4,
          elapsed: Duration.millis(250),
        });
        const slowest = yield* store.slowest(2);
        expect(slowest.map((c) => c.success)).toEqual([4, 8]);
        expect(slowest[0]?.success).toBe(4);
      }).pipe(Effect.provide(DoublerStore.layerMemory), Effect.scoped),
  );
});

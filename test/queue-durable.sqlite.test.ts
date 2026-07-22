import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { describe, expect, it } from "@effect/vitest";
import { Context, Duration, Effect, Layer, Ref, Schema, Scope } from "effect";
import { SqlClient } from "effect/unstable/sql/SqlClient";
import { DurableQueueStore } from "../src/DurableQueueStore";
import * as QueueHyperlink from "../src/QueueHyperlink";
import { SQLiteDurableQueueStore } from "../src/storage/sqlite";

// A DurableQueueStore over a shared in-memory SQLite client — the same store can back two queue
// instances (to simulate a restart).
const makeStoreLayer = Effect.gen(function* () {
  const scope = yield* Scope.Scope;
  const context = yield* Layer.buildWithScope(
    SqliteClient.layer({ filename: ":memory:" }),
    scope,
  );
  const sql = Context.get(context, SqlClient);
  const shape = yield* SQLiteDurableQueueStore.fromSqlClient(sql).pipe(Effect.orDie);
  return Layer.succeed(DurableQueueStore, shape);
});

const waitUntil = (predicate: Effect.Effect<boolean>) =>
  Effect.gen(function* () {
    while (!(yield* predicate)) yield* Effect.sleep(Duration.millis(10));
  }).pipe(Effect.timeout(Duration.seconds(3)));

describe("QueueHyperlink persist (SQLite durability)", () => {
  it.live("processes persisted items via the feeder, then drains the store", () =>
    Effect.gen(function* () {
      const storeLayer = yield* makeStoreLayer;
      const results = yield* Ref.make<Array<number>>([]);
      yield* Effect.gen(function* () {
        const queue = yield* QueueHyperlink.make({
          name: "dq-basic",
          itemSchema: Schema.Number,
          effect: (n: number) => Ref.update(results, (a) => [...a, n]),
        });
        yield* queue.add([1, 2, 3]);
        yield* waitUntil(Effect.map(queue.completed, (c) => c >= 3));
        expect(yield* queue.size.get).toBe(0); // store drained on completion
      }).pipe(Effect.provide(storeLayer), Effect.scoped);
      expect((yield* Ref.get(results)).sort()).toEqual([1, 2, 3]);
    }),
  );

  it.live("recovers persisted work across a restart (new instance, same store)", () =>
    Effect.gen(function* () {
      const storeLayer = yield* makeStoreLayer;

      // Instance 1: enqueue without starting workers — items land in the store, unprocessed.
      yield* Effect.gen(function* () {
        const queue = yield* QueueHyperlink.make({
          name: "dq-recover",
          itemSchema: Schema.Number,
          effect: (_n: number) => Effect.void,
          autoStart: false,
        });
        yield* queue.add([10, 20, 30]);
        expect(yield* queue.size.get).toBe(3); // persisted, pending
      }).pipe(Effect.provide(storeLayer), Effect.scoped);

      // Instance 2: same store, fresh runtime — recovers + processes the leftover work.
      const results = yield* Ref.make<Array<number>>([]);
      yield* Effect.gen(function* () {
        const queue = yield* QueueHyperlink.make({
          name: "dq-recover",
          itemSchema: Schema.Number,
          effect: (n: number) => Ref.update(results, (a) => [...a, n]),
        });
        yield* waitUntil(Effect.map(queue.completed, (c) => c >= 3));
      }).pipe(Effect.provide(storeLayer), Effect.scoped);

      expect((yield* Ref.get(results)).sort()).toEqual([10, 20, 30]);
    }),
  );

  it.live("retries via the store, then dead-letters at maxAttempts", () =>
    Effect.gen(function* () {
      const storeLayer = yield* makeStoreLayer;
      const runs = yield* Ref.make(0);
      yield* Effect.gen(function* () {
        const queue = yield* QueueHyperlink.make({
          name: "dq-retry",
          itemSchema: Schema.Number,
          effect: (_n: number) =>
            Effect.flatMap(Ref.update(runs, (n) => n + 1), () =>
              Effect.fail("boom" as const),
            ),
          attempts: 1, // enable auto re-enqueue; maxAttempts (before dead-letter) derives to attempts + 1 = 2
        });
        yield* queue.add(1);
        yield* waitUntil(Effect.map(Ref.get(runs), (n) => n >= 2));
        // after dead-lettering, no pending work remains
        yield* waitUntil(Effect.map(queue.size.get, (s) => s === 0));
      }).pipe(Effect.provide(storeLayer), Effect.scoped);
      expect(yield* Ref.get(runs)).toBe(2); // tried twice, then dead-lettered
    }),
  );

  it.live("release pulls the durable backlog out of the store", () =>
    Effect.gen(function* () {
      const storeLayer = yield* makeStoreLayer;
      yield* Effect.gen(function* () {
        const queue = yield* QueueHyperlink.make({
          name: "dq-release",
          itemSchema: Schema.Number,
          effect: (_n: number) => Effect.void,
          autoStart: false, // keep the backlog available (not leased) for release
        });
        yield* queue.add([1, 2, 3]);
        const released = yield* queue.release({});
        expect(released.map((e) => e.item).sort()).toEqual([1, 2, 3]);
        expect(yield* queue.size.get).toBe(0); // store drained
      }).pipe(Effect.provide(storeLayer), Effect.scoped);
    }),
  );

  it.live("deadLetter / drop by key remove from the durable store", () =>
    Effect.gen(function* () {
      const storeLayer = yield* makeStoreLayer;
      yield* Effect.gen(function* () {
        const queue = yield* QueueHyperlink.make({
          name: "dq-route",
          itemSchema: Schema.Number,
          key: (n: number) => String(n),
          effect: (_n: number) => Effect.void,
          autoStart: false,
        });
        yield* queue.add([1, 2, 3]);
        yield* queue.deadLetter({ key: "1" }, { reason: "test" });
        yield* queue.drop({ key: "2" }, { reason: "test" });
        expect(yield* queue.size.get).toBe(1); // only item 3 remains in the store
        const left = yield* queue.release({});
        expect(left.map((e) => e.item)).toEqual([3]);
      }).pipe(Effect.provide(storeLayer), Effect.scoped);
    }),
  );
});

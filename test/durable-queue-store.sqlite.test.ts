import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Layer, Option, Scope } from "effect";
import { SqlClient } from "effect/unstable/sql/SqlClient";
import { SQLiteDurableQueueStore } from "../src/storage/sqlite";

// A fresh in-memory SQLite store per test — real SQL semantics, no shared state.
const makeStore = Effect.gen(function* () {
  const scope = yield* Scope.Scope;
  const context = yield* Layer.buildWithScope(
    SqliteClient.layer({ filename: ":memory:" }),
    scope,
  );
  const sql = Context.get(context, SqlClient);
  return yield* SQLiteDurableQueueStore.fromSqlClient(sql).pipe(Effect.orDie);
});

describe("SQLiteDurableQueueStore", () => {
  it.live("offer → take → complete preserves payload; sizes track pending", () =>
    Effect.gen(function* () {
      const store = yield* makeStore;
      expect(
        yield* store.offer({
          id: "a",
          key: "q",
          priority: "normal",
          payload: { n: 1 },
        }),
      ).toBe("inserted");
      expect(yield* store.sizes("q")).toEqual({ high: 0, normal: 1, low: 0 });

      const taken = yield* store.take({ key: "q", leaseMillis: 1000 });
      expect(Option.isSome(taken)).toBe(true);
      if (Option.isSome(taken)) {
        expect(taken.value.payload).toEqual({ n: 1 });
        expect(taken.value.attempts).toBe(1);
        yield* store.complete(taken.value.id);
      }
      expect(yield* store.sizes("q")).toEqual({ high: 0, normal: 0, low: 0 });
    }),
  );

  it.live("take honors strict priority, then FIFO within a priority", () =>
    Effect.gen(function* () {
      const store = yield* makeStore;
      yield* store.offer({ id: "l", key: "q", priority: "low", payload: 0 });
      yield* store.offer({ id: "n1", key: "q", priority: "normal", payload: 0 });
      yield* store.offer({ id: "n2", key: "q", priority: "normal", payload: 0 });
      yield* store.offer({ id: "h", key: "q", priority: "high", payload: 0 });

      const order: Array<string> = [];
      for (let i = 0; i < 4; i++) {
        const t = yield* store.take({ key: "q", leaseMillis: 10_000 });
        if (Option.isSome(t)) {
          order.push(t.value.id);
          yield* store.complete(t.value.id);
        }
      }
      expect(order).toEqual(["h", "n1", "n2", "l"]);
    }),
  );

  it.live("dedups on dedupKey, and escalates priority for a live key", () =>
    Effect.gen(function* () {
      const store = yield* makeStore;
      expect(
        yield* store.offer({ id: "1", key: "q", dedupKey: "k", priority: "low", payload: 1 }),
      ).toBe("inserted");
      expect(
        yield* store.offer({ id: "2", key: "q", dedupKey: "k", priority: "low", payload: 2 }),
      ).toBe("deduplicated");
      expect(yield* store.sizes("q")).toEqual({ high: 0, normal: 0, low: 1 });

      expect(
        yield* store.offer({ id: "3", key: "q", dedupKey: "k", priority: "high", payload: 3 }),
      ).toBe("escalated");
      const t = yield* store.take({ key: "q", leaseMillis: 1000 });
      expect(Option.isSome(t) && t.value.priority).toBe("high");
    }),
  );

  it.live("a lease hides in-flight work; recover reclaims it (at-least-once)", () =>
    Effect.gen(function* () {
      const store = yield* makeStore;
      yield* store.offer({ id: "a", key: "q", priority: "normal", payload: 1 });

      const first = yield* store.take({ key: "q", leaseMillis: 60_000 });
      expect(Option.isSome(first)).toBe(true);
      // still leased → nothing else available
      expect(
        Option.isNone(yield* store.take({ key: "q", leaseMillis: 1000 })),
      ).toBe(true);

      expect(yield* store.recover("q")).toBe(1); // clears the lease
      const again = yield* store.take({ key: "q", leaseMillis: 1000 });
      expect(Option.isSome(again) && again.value.attempts).toBe(2); // redelivered
    }),
  );

  it.live("fail requeues until maxAttempts, then dead-letters", () =>
    Effect.gen(function* () {
      const store = yield* makeStore;
      yield* store.offer({ id: "a", key: "q", priority: "normal", payload: 1 });

      yield* store.take({ key: "q", leaseMillis: 1000 }); // attempts = 1
      expect(yield* store.fail("a", { maxAttempts: 2 })).toBe("requeued");
      yield* store.take({ key: "q", leaseMillis: 1000 }); // attempts = 2
      expect(yield* store.fail("a", { maxAttempts: 2 })).toBe("deadLettered");

      // dead rows are not pending
      expect(yield* store.sizes("q")).toEqual({ high: 0, normal: 0, low: 0 });
    }),
  );
});

import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { describe, expect, it } from "@effect/vitest";
import { Context, Duration, Effect, Layer, Schema, Scope } from "effect";
import { SqlClient } from "effect/unstable/sql/SqlClient";
import { HistoryStore, QueueResource } from "../src";
import { SQLiteHistoryStore } from "../src/storage/sqlite";

const withSql = <A, E>(
  f: (sql: SqlClient) => Effect.Effect<A, E, Scope.Scope>,
): Effect.Effect<A, E, Scope.Scope> =>
  Effect.gen(function* () {
    const scope = yield* Scope.Scope;
    const context = yield* Layer.buildWithScope(
      SqliteClient.layer({ filename: ":memory:" }),
      scope,
    );
    return yield* f(Context.get(context, SqlClient));
  });

describe("SQLiteHistoryStore", () => {
  it.live("append + read round-trip with limit/window filters", () =>
    withSql((sql) =>
      Effect.gen(function* () {
        const store = yield* SQLiteHistoryStore.fromSqlClient(sql).pipe(Effect.orDie);
        yield* store.append("s", { a: 1 });
        yield* store.append("s", { a: 2 });
        yield* store.append("s", { a: 3 });
        expect(yield* store.read("s")).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
        expect(yield* store.read("s", { limit: 2 })).toEqual([{ a: 2 }, { a: 3 }]);
        expect(yield* store.read("other")).toEqual([]);
      }),
    ),
  );

  it.live("capacity keeps only the newest N entries per stream", () =>
    withSql((sql) =>
      Effect.gen(function* () {
        const store = yield* SQLiteHistoryStore.fromSqlClient(sql, {
          capacity: 2,
        }).pipe(Effect.orDie);
        yield* store.append("s", 1);
        yield* store.append("s", 2);
        yield* store.append("s", 3);
        expect(yield* store.read("s")).toEqual([2, 3]); // 1 pruned
      }),
    ),
  );

  it.live("history survives across store instances (same db = restart)", () =>
    withSql((sql) =>
      Effect.gen(function* () {
        const writer = yield* SQLiteHistoryStore.fromSqlClient(sql).pipe(Effect.orDie);
        yield* writer.append("s", { x: 1 });
        const reader = yield* SQLiteHistoryStore.fromSqlClient(sql).pipe(Effect.orDie);
        expect(yield* reader.read("s")).toEqual([{ x: 1 }]);
      }),
    ),
  );

  it.live("queue logHistory reads back through the SQLite HistoryStore", () =>
    withSql((sql) =>
      Effect.gen(function* () {
        const storeLayer = Layer.effect(
          HistoryStore,
          SQLiteHistoryStore.fromSqlClient(sql).pipe(Effect.orDie),
        );
        const NumberItem = Schema.Struct({ n: Schema.Number });
        class SQ extends QueueResource.Tag<SQ>()("sqlite-history/Q", NumberItem) {}

        yield* Effect.gen(function* () {
          const queue = yield* SQ;
          yield* queue.add([{ n: 1 }, { n: 2 }]);
          yield* Effect.gen(function* () {
            while ((yield* queue.logs.history({})).length === 0) {
              yield* Effect.sleep(Duration.millis(10));
            }
          }).pipe(Effect.timeout(Duration.seconds(2)));
          expect((yield* queue.logs.history({ limit: 50 })).length).toBeGreaterThan(0);
        }).pipe(
          Effect.provide(
            QueueResource.layer(SQ, {
              effect: (item) => Effect.logInfo(`processed ${item.n}`),
              captureLogs: true,
            }).pipe(Layer.provide(storeLayer)),
          ),
          Effect.scoped,
        );
      }),
    ),
  );
});

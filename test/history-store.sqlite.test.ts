import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Layer, Scope } from "effect";
import { SqlClient } from "effect/unstable/sql/SqlClient";
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

});

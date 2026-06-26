/**
 * **SQLite backend for {@link HistoryStore}** — the observability plane (metrics/logs history) over
 * one append-only `(stream_id, ts, json)` table, so `*History` reads survive a restart. Append/read
 * are best-effort (the shape has no error channel): a backend failure is logged, not thrown.
 *
 * Off the core entry — import from `@nikscripts/effect-pm/storage/sqlite`.
 *
 * @module storage/sqlite/historyStore
 */
import { Clock, Context, DateTime, Effect, Layer, Schema, Scope } from "effect";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import type { SqliteClientConfig } from "@effect/sql-sqlite-node/SqliteClient";
import { SqlClient } from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { HistoryStoreTag } from "../../HistoryStore";
import type { HistoryStoreShape } from "../../HistoryStore";

const TABLE = "history_entries";

const ddl: ReadonlyArray<string> = [
  `CREATE TABLE IF NOT EXISTS ${TABLE} (
     stream_id TEXT NOT NULL,
     ts INTEGER NOT NULL,
     json TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS ${TABLE}_stream_ts_idx ON ${TABLE}(stream_id, ts)`,
];

// Opaque entry ⇄ JSON column (Schema, not raw JSON.parse/stringify). Entries are already-encoded
// JSON owned by the caller, so the sync round-trip can't fail on our own data.
const encodeEntry = Schema.encodeSync(Schema.UnknownFromJsonString);
const decodeEntry = Schema.decodeUnknownSync(Schema.UnknownFromJsonString);

const asRecord = (row: unknown): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  if (typeof row === "object" && row !== null) {
    for (const [key, value] of Object.entries(row)) out[key] = value;
  }
  return out;
};

const install = (sql: SqlClient): Effect.Effect<void, SqlError> =>
  Effect.forEach(ddl, (stmt) => Effect.asVoid(sql.unsafe(stmt).unprepared), {
    discard: true,
  });

const makeService = (
  sql: SqlClient,
  capacity: number | undefined,
): HistoryStoreShape => ({
  append: (streamId, entry) =>
    Effect.gen(function* () {
      const ts = yield* Clock.currentTimeMillis;
      yield* sql`INSERT INTO ${sql(TABLE)} ${sql.insert({ stream_id: streamId, ts, json: encodeEntry(entry) })}`;
      if (capacity !== undefined) {
        // count-based retention: keep the newest `capacity` rows for this stream
        yield* sql`DELETE FROM ${sql(TABLE)} WHERE stream_id = ${streamId} AND rowid NOT IN (SELECT rowid FROM ${sql(TABLE)} WHERE stream_id = ${streamId} ORDER BY ts DESC, rowid DESC LIMIT ${capacity})`;
      }
    }).pipe(
      Effect.catch((error) =>
        Effect.logError(`HistoryStore (sqlite) append failed: ${String(error)}`),
      ),
    ),

  read: (streamId, options) =>
    Effect.gen(function* () {
      const since =
        options?.since !== undefined ? DateTime.toEpochMillis(options.since) : undefined;
      const until =
        options?.until !== undefined ? DateTime.toEpochMillis(options.until) : undefined;
      const limit = options?.limit;

      let text = `SELECT json FROM ${TABLE} WHERE stream_id = ?`;
      const params: Array<string | number> = [streamId];
      if (since !== undefined) {
        text += ` AND ts >= ?`;
        params.push(since);
      }
      if (until !== undefined) {
        text += ` AND ts <= ?`;
        params.push(until);
      }
      if (limit !== undefined) {
        // newest `limit` (fetched DESC, returned ascending below)
        text += ` ORDER BY ts DESC, rowid DESC LIMIT ?`;
        params.push(limit);
      } else {
        text += ` ORDER BY ts ASC, rowid ASC`;
      }

      const rows = yield* sql.unsafe(text, params);
      const decoded = rows.map((row) => decodeEntry(String(asRecord(row)["json"])));
      return limit !== undefined ? decoded.reverse() : decoded;
    }).pipe(
      Effect.catch((error) =>
        Effect.as(
          Effect.logError(`HistoryStore (sqlite) read failed: ${String(error)}`),
          [] as ReadonlyArray<unknown>,
        ),
      ),
    ),
});

/**
 * Install the schema on an existing {@link SqlClient} and return the {@link HistoryStore} port — for
 * tests (`:memory:`) or a shared client. `capacity` keeps only the newest N entries per stream.
 *
 * @public
 */
export const fromSqlClient = (
  sql: SqlClient,
  options?: { readonly capacity?: number },
): Effect.Effect<HistoryStoreShape, SqlError> =>
  Effect.map(install(sql), () => makeService(sql, options?.capacity));

/**
 * `Layer` providing {@link HistoryStore} backed by SQLite (scoped `SqliteClient` lifecycle).
 *
 * @public
 */
export const layer = (
  config: SqliteClientConfig & { readonly capacity?: number },
): Layer.Layer<HistoryStoreTag, SqlError, Scope.Scope> =>
  Layer.effect(
    HistoryStoreTag,
    Effect.gen(function* () {
      const scope = yield* Scope.Scope;
      const context = yield* Layer.buildWithScope(SqliteClient.layer(config), scope);
      const sql = Context.get(context, SqlClient);
      yield* install(sql);
      return makeService(sql, config.capacity);
    }),
  );

/**
 * SQLite {@link HistoryStore} backend.
 *
 * @public
 */
export const SQLiteHistoryStore = {
  layer,
  fromSqlClient,
} as const;

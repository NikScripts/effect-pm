/**
 * ShardMap SQLite persistence — SSOT for local shard rows.
 *
 * One table, keyed by `(scope_key, entry_key)`. No store port, no event journal: the engine
 * talks to {@link SqlClient} directly. Default client is in-memory SQLite (`:memory:`).
 *
 * @module internal/shardMapSql
 * @internal
 */
import { Effect, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql/SqlClient";

const TABLE = "effect_pm_shard_map";

const encodeValue = Schema.encodeSync(Schema.UnknownFromJsonString);
const decodeValue = Schema.decodeUnknownSync(Schema.UnknownFromJsonString);

const ddl = `CREATE TABLE IF NOT EXISTS ${TABLE} (
  scope_key TEXT NOT NULL,
  entry_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  PRIMARY KEY (scope_key, entry_key)
)`;

/** Narrow an unknown SELECT row. @internal */
const asRecord = (row: unknown): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  if (typeof row === "object" && row !== null) {
    for (const [key, value] of Object.entries(row)) out[key] = value;
  }
  return out;
};

/** Install the shard-map schema (idempotent). @internal */
export const install = (sql: SqlClient): Effect.Effect<void> =>
  Effect.asVoid(sql.unsafe(ddl).unprepared).pipe(Effect.orDie);

/** Load every live row for a scope into a Map. @internal */
export const loadScope = (
  sql: SqlClient,
  scopeKey: string,
): Effect.Effect<Map<string, unknown>> =>
  sql`SELECT entry_key, value_json FROM ${sql(TABLE)} WHERE scope_key = ${scopeKey}`.pipe(
    Effect.map((rows) => {
      const map = new Map<string, unknown>();
      for (const row of rows) {
        const rec = asRecord(row);
        map.set(String(rec["entry_key"]), decodeValue(String(rec["value_json"])));
      }
      return map;
    }),
    Effect.orDie,
  );

/** Upsert one live row. @internal */
export const upsert = (
  sql: SqlClient,
  scopeKey: string,
  entryKey: string,
  value: unknown,
): Effect.Effect<void> =>
  sql`
    INSERT INTO ${sql(TABLE)} (scope_key, entry_key, value_json)
    VALUES (${scopeKey}, ${entryKey}, ${encodeValue(value)})
    ON CONFLICT(scope_key, entry_key) DO UPDATE SET value_json = excluded.value_json
  `.pipe(Effect.asVoid, Effect.orDie);

/** Delete one live row. @internal */
export const deleteKey = (
  sql: SqlClient,
  scopeKey: string,
  entryKey: string,
): Effect.Effect<void> =>
  sql`DELETE FROM ${sql(TABLE)} WHERE scope_key = ${scopeKey} AND entry_key = ${entryKey}`.pipe(
    Effect.asVoid,
    Effect.orDie,
  );

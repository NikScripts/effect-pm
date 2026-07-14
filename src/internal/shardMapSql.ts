/**
 * ShardMap SQLite persistence — SSOT for local shard rows.
 *
 * One table, keyed by `(scope_key, entry_key)`. No store port, no event journal: the engine
 * talks to {@link SqlClient} directly. Default client is in-memory SQLite (`:memory:`).
 *
 * @module shardMapSql
 * @internal
 */
import { Data, Effect, Schema } from "effect";
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

/**
 * SQLite / codec failure for shard-map persistence.
 *
 * Resource wire methods stay `never` in `E` (boolean / void success), so the engine turns this into
 * a defect at the boundary — SSOT rows must not update the hot Map if SQL failed (`Effect.orDie` at
 * the Resource wire edge).
 *
 * @internal
 */
export class ShardMapSqlError extends Data.TaggedError(
  "@nikscripts/effect-pm/ShardMapSqlError",
)<{
  readonly operation: "install" | "load" | "upsert" | "delete";
  readonly scopeKey?: string;
  readonly entryKey?: string;
  readonly cause: unknown;
}> {}

/** Narrow an unknown SELECT row into a plain record. @internal */
const rowRecord = (row: unknown): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  if (typeof row === "object" && row !== null) {
    for (const [key, value] of Object.entries(row)) out[key] = value;
  }
  return out;
};

const fail =
  (
    operation: ShardMapSqlError["operation"],
    meta?: { readonly scopeKey?: string; readonly entryKey?: string },
  ) =>
  (cause: unknown) =>
    new ShardMapSqlError({
      operation,
      cause,
      ...(meta?.scopeKey !== undefined ? { scopeKey: meta.scopeKey } : {}),
      ...(meta?.entryKey !== undefined ? { entryKey: meta.entryKey } : {}),
    });

/** Install the shard-map schema (idempotent). @internal */
export const install = (
  sql: SqlClient,
): Effect.Effect<void, ShardMapSqlError> =>
  Effect.asVoid(sql.unsafe(ddl).unprepared).pipe(
    Effect.mapError(fail("install")),
  );

/** Load every live row for a scope into a Map (JSON values still opaque). @internal */
export const loadScope = (
  sql: SqlClient,
  scopeKey: string,
): Effect.Effect<Map<string, unknown>, ShardMapSqlError> =>
  sql`SELECT entry_key, value_json FROM ${sql(TABLE)} WHERE scope_key = ${scopeKey}`.pipe(
    Effect.mapError(fail("load", { scopeKey })),
    Effect.flatMap((rows) =>
      Effect.try({
        try: () => {
          const map = new Map<string, unknown>();
          for (const row of rows) {
            const rec = rowRecord(row);
            map.set(
              String(rec["entry_key"]),
              decodeValue(String(rec["value_json"])),
            );
          }
          return map;
        },
        catch: (cause) => fail("load", { scopeKey })(cause),
      }),
    ),
  );

/** Upsert one live row. @internal */
export const upsert = (
  sql: SqlClient,
  scopeKey: string,
  entryKey: string,
  value: unknown,
): Effect.Effect<void, ShardMapSqlError> =>
  Effect.gen(function* () {
    const valueJson = yield* Effect.try({
      try: () => encodeValue(value),
      catch: (cause) => fail("upsert", { scopeKey, entryKey })(cause),
    });
    yield* sql`
      INSERT INTO ${sql(TABLE)} (scope_key, entry_key, value_json)
      VALUES (${scopeKey}, ${entryKey}, ${valueJson})
      ON CONFLICT(scope_key, entry_key) DO UPDATE SET value_json = excluded.value_json
    `.pipe(Effect.mapError(fail("upsert", { scopeKey, entryKey })));
  });

/** Delete one live row. @internal */
export const deleteKey = (
  sql: SqlClient,
  scopeKey: string,
  entryKey: string,
): Effect.Effect<void, ShardMapSqlError> =>
  sql`DELETE FROM ${sql(TABLE)} WHERE scope_key = ${scopeKey} AND entry_key = ${entryKey}`.pipe(
    Effect.asVoid,
    Effect.mapError(fail("delete", { scopeKey, entryKey })),
  );

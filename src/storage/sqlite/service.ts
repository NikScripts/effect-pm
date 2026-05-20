/**
 * `RuntimeStorageService` implementation backed by SQLite.
 *
 * @remarks
 * Every public method follows the same evaluation strategy:
 *
 * 1. Load **all** rows from the physical table into memory through
 *    {@link SqlClient}.
 * 2. Delegate filtering, ordering, pagination, and readonly interaction rules to
 *    {@link selectRuntimeRecords} and {@link applyRuntimeRecordPatch} from
 *    `RuntimeStorage.ts`.
 *
 * That keeps semantics aligned with {@link RuntimeStorage.memory} at the cost
 * of `O(n)` work per call. For large tables, a future iteration can push
 * predicates into SQL while keeping a conformance suite locked to the shared
 * in-memory reference.
 *
 * @module storage/sqlite/service
 * @internal
 */

import { Effect } from "effect";
import type { SqlClient } from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";
import {
  RuntimeStorageDuplicateRecordError,
  RuntimeStorageReadonlyRecordError,
  applyRuntimeRecordPatch,
  selectRuntimeRecords,
  type DeleteResult,
  type RuntimeRecord,
  type RuntimeStorageService,
  type UpdateResult,
} from "../../RuntimeStorage";
import { RUNTIME_RECORDS_TABLE } from "./constants";
import {
  decodeRuntimeRecordRow,
  encodeRuntimeRecordParams,
  predicateIncludesReadonlyTrue,
} from "./codec";

const insertRow = (record: RuntimeRecord): Record<string, unknown> => ({ ...encodeRuntimeRecordParams(record) });

const rowObjectToRecord = (row: object): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(row)) {
    if (typeof key === "string") {
      out[key] = Reflect.get(row, key);
    }
  }
  return out;
};

const loadAllRuntimeRecords = (
  sql: SqlClient,
): Effect.Effect<ReadonlyArray<RuntimeRecord>, SqlError> =>
  Effect.map(sql`SELECT * FROM ${sql(RUNTIME_RECORDS_TABLE)}`, (rows) =>
    rows.map((row): RuntimeRecord => {
      if (typeof row !== "object" || row === null) {
        throw new Error("SQLiteRuntimeStorage: expected object row from SELECT *");
      }
      return decodeRuntimeRecordRow(rowObjectToRecord(row));
    }),
  );

const readConstraintCode = (cause: unknown): string | undefined => {
  if (typeof cause !== "object" || cause === null || !("code" in cause)) {
    return undefined;
  }
  const code = Reflect.get(cause, "code");
  return typeof code === "string" || typeof code === "number" ? String(code) : undefined;
};

const readConstraintMessage = (cause: unknown): string => {
  if (typeof cause !== "object" || cause === null || !("message" in cause)) {
    return "";
  }
  const message = Reflect.get(cause, "message");
  return typeof message === "string" ? message : "";
};

const isDuplicateKeySqlError = (error: SqlError): boolean => {
  if (error.reason._tag === "UniqueViolation") {
    return true;
  }
  if (error.reason._tag === "ConstraintError") {
    const cause = error.reason.cause;
    const code = readConstraintCode(cause);
    if (code === "SQLITE_CONSTRAINT_PRIMARYKEY" || code === "SQLITE_CONSTRAINT_UNIQUE") {
      return true;
    }
    if (code === "SQLITE_CONSTRAINT") {
      const message = readConstraintMessage(cause);
      return message.includes("UNIQUE") || message.includes("PRIMARY KEY");
    }
  }
  return false;
};

const dieSql = <A, R>(self: Effect.Effect<A, SqlError, R>): Effect.Effect<A, never, R> => Effect.orDie(self);

/**
 * Construct the storage port for an already-provided {@link SqlClient}.
 *
 * @param sql - Effect SQL client; must remain available for the lifetime of the
 *   returned service.
 */
export const makeSqliteRuntimeStorageService = (sql: SqlClient): RuntimeStorageService => ({
  create: (record) =>
    sql`INSERT INTO ${sql(RUNTIME_RECORDS_TABLE)} ${sql.insert(insertRow(record))}`.pipe(
      Effect.catchTag("SqlError", (error) =>
        isDuplicateKeySqlError(error)
          ? Effect.fail(new RuntimeStorageDuplicateRecordError({ id: record.id }))
          : Effect.die(error),
      ),
    ),

  read: (query) =>
    Effect.gen(function* () {
      const all = yield* loadAllRuntimeRecords(sql).pipe(dieSql);
      return selectRuntimeRecords(all, query);
    }),

  upsert: (record) =>
    Effect.gen(function* () {
      const existing = yield* sql`SELECT readonly_int FROM ${sql(RUNTIME_RECORDS_TABLE)} WHERE id = ${record.id}`.pipe(
        dieSql,
      );
      const firstUnknown = existing[0];
      const readonlyInt =
        firstUnknown !== undefined && typeof firstUnknown === "object" && firstUnknown !== null
          ? rowObjectToRecord(firstUnknown)["readonly_int"]
          : undefined;
      if (firstUnknown !== undefined && Number(readonlyInt) === 1) {
        return yield* Effect.fail(new RuntimeStorageReadonlyRecordError({ id: record.id }));
      }
      yield* dieSql(
        sql`INSERT OR REPLACE INTO ${sql(RUNTIME_RECORDS_TABLE)} ${sql.insert(insertRow(record))}`,
      );
    }),

  update: (query, patch) =>
    Effect.gen(function* () {
      const all = yield* loadAllRuntimeRecords(sql).pipe(dieSql);
      const matching = selectRuntimeRecords(all, query);
      let matched = 0;
      let updated = 0;
      for (const row of matching) {
        matched++;
        if (row.readonly === true) {
          continue;
        }
        yield* dieSql(
          sql`INSERT OR REPLACE INTO ${sql(RUNTIME_RECORDS_TABLE)} ${sql.insert(
            insertRow(applyRuntimeRecordPatch(row, patch)),
          )}`,
        );
        updated++;
      }
      return { matched, updated } satisfies UpdateResult;
    }),

  delete: (query) =>
    Effect.gen(function* () {
      const includeReadonly = predicateIncludesReadonlyTrue(query.predicate);
      const all = yield* loadAllRuntimeRecords(sql).pipe(dieSql);
      const matching = selectRuntimeRecords(all, query);
      let deleted = 0;
      for (const row of matching) {
        if (row.readonly === true && !includeReadonly) {
          continue;
        }
        yield* dieSql(sql`DELETE FROM ${sql(RUNTIME_RECORDS_TABLE)} WHERE id = ${row.id}`);
        deleted++;
      }
      return { deleted } satisfies DeleteResult;
    }),
});

/**
 * `RuntimeStorageService` implementation backed by SQLite.
 *
 * @remarks
 * Read queries push supported predicates, ordering, and windows into SQL through
 * whitelisted columns and bound parameters. Mutating queries load matching rows
 * through the same query compiler, then apply readonly rules in TypeScript so
 * semantics stay aligned with {@link RuntimeStorage.memory}.
 *
 * The compiler intentionally builds SQL only from a fixed column/operator
 * whitelist; all runtime values are passed as SQL parameters.
 *
 * @module storage/sqlite/service
 * @internal
 */

import { DateTime, Effect } from "effect";
import type { SqlClient } from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";
import type {
  RuntimeRecordField,
  RuntimeRecordOrderField,
  RuntimeRecordPredicate,
  RuntimeRecordQuery,
} from "../../Query";
import {
  RuntimeStorageDecodeError,
  RuntimeStorageDuplicateRecordError,
  RuntimeStorageEncodeError,
  RuntimeStorageQueryError,
  RuntimeStorageReadonlyRecordError,
  applyRuntimeRecordPatch,
  type DeleteResult,
  type RuntimeRecord,
  type RuntimeStorageService,
  type UpdateResult,
} from "../../RuntimeStorage";
import { RUNTIME_RECORDS_TABLE } from "./constants";
import {
  decodeRuntimeRecordRowEffect,
  encodeRuntimeRecordParamsEffect,
  predicateIncludesReadonlyTrue,
} from "./codec";

const insertRowEffect = (record: RuntimeRecord): Effect.Effect<Record<string, unknown>, RuntimeStorageEncodeError, never> =>
  Effect.map(encodeRuntimeRecordParamsEffect(record), (params) => ({ ...params }));

const rowObjectToRecord = (row: object): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(row)) {
    if (typeof key === "string") {
      out[key] = Reflect.get(row, key);
    }
  }
  return out;
};

const rowId = (row: Readonly<Record<string, unknown>>): string | undefined => {
  const id = row["id"];
  return typeof id === "string" ? id : undefined;
};

const rowToRuntimeRecord = (row: unknown): Effect.Effect<RuntimeRecord, RuntimeStorageDecodeError, never> =>
  typeof row === "object" && row !== null
    ? Effect.mapError(
        decodeRuntimeRecordRowEffect(rowObjectToRecord(row)),
        (cause) =>
          new RuntimeStorageDecodeError({
            adapter: "sqlite",
            operation: "read",
            id: rowId(rowObjectToRecord(row)),
            cause,
            detail: "Failed to decode runtime_records row",
          }),
      )
    : Effect.fail(
        new RuntimeStorageDecodeError({
          adapter: "sqlite",
          operation: "read",
          cause: new Error("SQLiteRuntimeStorage: expected object row from SELECT *"),
          detail: "Expected object row from SELECT *",
        }),
      );

interface SqlSelection {
  readonly text: string;
  readonly params: ReadonlyArray<unknown>;
}

const stringFieldColumns: Record<Exclude<RuntimeRecordField, "readonly">, string> = {
  id: "id",
  type: "type",
  runId: "run_id",
  processType: "process_type",
  processId: "process_id",
  subjectType: "subject_type",
  subjectId: "subject_id",
  key: "key",
  indexA: "index_a",
  indexB: "index_b",
  indexC: "index_c",
  indexD: "index_d",
  indexE: "index_e",
  indexF: "index_f",
  indexG: "index_g",
  indexH: "index_h",
};

const dateFieldColumns = {
  occurredAt: "occurred_at_ms",
  createdAt: "created_at_ms",
} as const satisfies Record<"occurredAt" | "createdAt", string>;

const orderFieldColumns: Record<RuntimeRecordOrderField, string> = {
  ...stringFieldColumns,
  readonly: "readonly_int",
  occurredAt: "occurred_at_ms",
  createdAt: "created_at_ms",
};

const optionalStringFields: ReadonlySet<RuntimeRecordField> = new Set([
  "subjectType",
  "subjectId",
  "key",
  "indexA",
  "indexB",
  "indexC",
  "indexD",
  "indexE",
  "indexF",
  "indexG",
  "indexH",
]);

const fieldColumn = (field: RuntimeRecordField): string =>
  field === "readonly" ? "readonly_int" : stringFieldColumns[field];

const comparisonValue = (field: RuntimeRecordField, value: string | boolean): string | number | null => {
  if (field === "readonly") {
    return typeof value === "boolean" ? (value ? 1 : 0) : value;
  }
  return typeof value === "string" ? value : null;
};

const dateMillis = (value: DateTime.Utc): number => DateTime.toEpochMillis(value);

const combineSelections = (
  operator: "AND" | "OR",
  fallback: string,
  selections: ReadonlyArray<SqlSelection>,
): SqlSelection => {
  if (selections.length === 0) {
    return { text: fallback, params: [] };
  }
  return {
    text: selections.map((selection) => `(${selection.text})`).join(` ${operator} `),
    params: selections.flatMap((selection) => selection.params),
  };
};

const predicateSql = (predicate: RuntimeRecordPredicate | undefined): SqlSelection | undefined => {
  if (predicate === undefined) {
    return undefined;
  }

  switch (predicate._tag) {
    case "Equals": {
      const column = fieldColumn(predicate.field);
      const value = comparisonValue(predicate.field, predicate.value);
      return value === null
        ? { text: "1 = 0", params: [] }
        : { text: `${column} = ?`, params: [value] };
    }
    case "NotEquals": {
      const column = fieldColumn(predicate.field);
      const value = comparisonValue(predicate.field, predicate.value);
      if (value === null) {
        return { text: "1 = 1", params: [] };
      }
      return optionalStringFields.has(predicate.field) || predicate.field === "readonly"
        ? { text: `(${column} IS NULL OR ${column} <> ?)`, params: [value] }
        : { text: `${column} <> ?`, params: [value] };
    }
    case "In": {
      const column = fieldColumn(predicate.field);
      const values = predicate.values
        .map((value) => comparisonValue(predicate.field, value))
        .filter((value): value is string | number => value !== null);
      if (values.length === 0) {
        return { text: "1 = 0", params: [] };
      }
      const expression = optionalStringFields.has(predicate.field) || predicate.field === "readonly"
        ? `COALESCE(${column}, '')`
        : column;
      return {
        text: `${expression} IN (${values.map(() => "?").join(", ")})`,
        params: values,
      };
    }
    case "IsNull": {
      const column = fieldColumn(predicate.field);
      return predicate.field === "readonly"
        ? { text: `${column} IS NULL`, params: [] }
        : { text: `${column} IS NULL`, params: [] };
    }
    case "IsNotNull": {
      const column = fieldColumn(predicate.field);
      return { text: `${column} IS NOT NULL`, params: [] };
    }
    case "After":
      return {
        text: `${dateFieldColumns[predicate.field]} > ?`,
        params: [dateMillis(predicate.value)],
      };
    case "Before":
      return {
        text: `${dateFieldColumns[predicate.field]} < ?`,
        params: [dateMillis(predicate.value)],
      };
    case "Between":
      return {
        text: `(${dateFieldColumns[predicate.field]} > ? AND ${dateFieldColumns[predicate.field]} < ?)`,
        params: [dateMillis(predicate.start), dateMillis(predicate.end)],
      };
    case "And":
      return combineSelections("AND", "1 = 0", predicate.predicates.map(predicateSql).filter((item): item is SqlSelection => item !== undefined));
    case "Or":
      return combineSelections("OR", "1 = 0", predicate.predicates.map(predicateSql).filter((item): item is SqlSelection => item !== undefined));
  }
};

const querySql = (query: RuntimeRecordQuery | undefined): SqlSelection => {
  const where = predicateSql(query?.predicate);
  const orderBy = query?.orderBy ?? [{ field: "occurredAt" as const, direction: "desc" as const }];
  const orderText = orderBy
    .map((order) => `${orderFieldColumns[order.field]} ${order.direction === "asc" ? "ASC" : "DESC"}`)
    .join(", ");
  const params = where === undefined ? [] : [...where.params];
  let text = `SELECT * FROM ${RUNTIME_RECORDS_TABLE}`;
  if (where !== undefined) {
    text += ` WHERE ${where.text}`;
  }
  text += ` ORDER BY ${orderText}`;
  if (query?.limit !== undefined) {
    text += " LIMIT ?";
    params.push(Math.max(0, query.limit));
  }
  if (query?.offset !== undefined) {
    if (query.limit === undefined) {
      text += " LIMIT -1";
    }
    text += " OFFSET ?";
    params.push(Math.max(0, query.offset));
  }
  return { text, params };
};

const loadRuntimeRecords = (
  sql: SqlClient,
  query?: RuntimeRecordQuery,
): Effect.Effect<ReadonlyArray<RuntimeRecord>, SqlError | RuntimeStorageDecodeError> => {
  const selection = querySql(query);
  return Effect.flatMap(
    sql.unsafe(selection.text, selection.params),
    (rows) => Effect.forEach(rows, rowToRuntimeRecord),
  );
};

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

const sqliteQueryError = (
  operation: "create" | "read" | "upsert" | "update" | "delete",
  error: SqlError,
): RuntimeStorageQueryError =>
  new RuntimeStorageQueryError({
    adapter: "sqlite",
    operation,
    cause: error,
  });

const sqliteLoadError = (
  operation: "read" | "update" | "delete",
  error: SqlError | RuntimeStorageDecodeError,
): RuntimeStorageQueryError | RuntimeStorageDecodeError =>
  error instanceof RuntimeStorageDecodeError ? error : sqliteQueryError(operation, error);

const sqliteWriteError = (
  operation: "create" | "upsert" | "update",
  error: SqlError | RuntimeStorageEncodeError,
): RuntimeStorageQueryError | RuntimeStorageEncodeError =>
  error instanceof RuntimeStorageEncodeError ? error : sqliteQueryError(operation, error);

/**
 * Construct the storage port for an already-provided {@link SqlClient}.
 *
 * @param sql - Effect SQL client; must remain available for the lifetime of the
 *   returned service.
 */
export const makeSqliteRuntimeStorageService = (sql: SqlClient): RuntimeStorageService => ({
  create: (record) =>
    Effect.flatMap(insertRowEffect(record), (row) =>
      sql`INSERT INTO ${sql(RUNTIME_RECORDS_TABLE)} ${sql.insert(row)}`.pipe(
        Effect.mapError((error) =>
          error instanceof RuntimeStorageEncodeError
            ? error
            : isDuplicateKeySqlError(error)
            ? new RuntimeStorageDuplicateRecordError({ id: record.id })
            : sqliteQueryError("create", error)
        ),
        Effect.asVoid,
      ),
    ),

  read: (query) =>
    Effect.map(
      loadRuntimeRecords(sql, query).pipe(
        Effect.mapError((error) => sqliteLoadError("read", error)),
      ),
      (rows) => [...rows],
    ),

  upsert: (record) =>
    Effect.gen(function* () {
      const existing = yield* sql`SELECT readonly_int FROM ${sql(RUNTIME_RECORDS_TABLE)} WHERE id = ${record.id}`.pipe(
        Effect.mapError((error) => sqliteQueryError("upsert", error)),
      );
      const firstUnknown = existing[0];
      const readonlyInt =
        firstUnknown !== undefined && typeof firstUnknown === "object" && firstUnknown !== null
          ? rowObjectToRecord(firstUnknown)["readonly_int"]
          : undefined;
      if (firstUnknown !== undefined && Number(readonlyInt) === 1) {
        return yield* new RuntimeStorageReadonlyRecordError({ id: record.id });
      }
      yield* Effect.flatMap(insertRowEffect(record), (row) =>
        sql`INSERT OR REPLACE INTO ${sql(RUNTIME_RECORDS_TABLE)} ${sql.insert(row)}`,
      ).pipe(
        Effect.mapError((error) => sqliteWriteError("upsert", error)),
      );
    }),

  update: (query, patch) =>
    Effect.gen(function* () {
      const matching = yield* loadRuntimeRecords(sql, query).pipe(
        Effect.mapError((error) => sqliteLoadError("update", error)),
      );
      let matched = 0;
      let updated = 0;
      for (const row of matching) {
        matched++;
        if (row.readonly === true) {
          continue;
        }
        yield* Effect.flatMap(insertRowEffect(applyRuntimeRecordPatch(row, patch)), (insertRow) =>
          sql`INSERT OR REPLACE INTO ${sql(RUNTIME_RECORDS_TABLE)} ${sql.insert(insertRow)}`,
        ).pipe(
          Effect.mapError((error) => sqliteWriteError("update", error)),
        );
        updated++;
      }
      return { matched, updated } satisfies UpdateResult;
    }),

  delete: (query) =>
    Effect.gen(function* () {
      const includeReadonly = predicateIncludesReadonlyTrue(query.predicate);
      const matching = yield* loadRuntimeRecords(sql, query).pipe(
        Effect.mapError((error) => sqliteLoadError("delete", error)),
      );
      let deleted = 0;
      for (const row of matching) {
        if (row.readonly === true && !includeReadonly) {
          continue;
        }
        yield* sql`DELETE FROM ${sql(RUNTIME_RECORDS_TABLE)} WHERE id = ${row.id}`.pipe(
          Effect.mapError((error) => sqliteQueryError("delete", error)),
        );
        deleted++;
      }
      return { deleted } satisfies DeleteResult;
    }),
});

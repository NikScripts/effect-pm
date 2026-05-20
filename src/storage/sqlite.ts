/**
 * SQLite-backed {@link RuntimeStorageService} for normalized runtime records.
 *
 * @remarks
 * Import from **`@nikscripts/effect-pm/storage/sqlite`**. Semantics match
 * {@link RuntimeStorage.memory}: filtering, ordering, limits, and readonly
 * rules are evaluated in-process via {@link selectRuntimeRecords} over the full
 * table snapshot so behavior stays aligned with the reference implementation.
 *
 * @module storage/sqlite
 */

import Database from "better-sqlite3";
import { Data, DateTime, Effect, Layer } from "effect";
import type { RuntimeRecordPredicate } from "../Query";
import type { JsonValue } from "../ProcessStoreEvent";
import { RuntimeStorage } from "../RuntimeStorage";
import {
  RuntimeStorageDuplicateRecordError,
  RuntimeStorageReadonlyRecordError,
  applyRuntimeRecordPatch,
  selectRuntimeRecords,
  type DeleteResult,
  type RuntimeRecord,
  type RuntimeStorageService,
  type UpdateResult,
} from "../RuntimeStorage";

const TABLE = "effect_pm_runtime_records";

const isJsonValue = (value: unknown): value is JsonValue => {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value).every(isJsonValue);
  }
  return false;
};

const parseJsonValue = (text: string | null | undefined): JsonValue | undefined => {
  if (text === null || text === undefined) {
    return undefined;
  }
  const parsed: unknown = JSON.parse(text);
  return isJsonValue(parsed) ? parsed : undefined;
};

const parseIndexNames = (text: string | null | undefined): ReadonlyArray<string> | undefined => {
  if (text === null || text === undefined) {
    return undefined;
  }
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    return undefined;
  }
  return parsed;
};

const includesReadonlyTrue = (
  predicate: RuntimeRecordPredicate | undefined,
): boolean => {
  if (predicate === undefined) {
    return false;
  }
  switch (predicate._tag) {
    case "Equals":
      return predicate.field === "readonly" && predicate.value === true;
    case "And":
    case "Or":
    case "Xor":
      return predicate.predicates.some(includesReadonlyTrue);
    default:
      return false;
  }
};

const isUniqueConstraint = (cause: unknown): boolean => {
  if (typeof cause === "object" && cause !== null && "code" in cause) {
    const code = (cause as { readonly code?: unknown }).code;
    return code === "SQLITE_CONSTRAINT_UNIQUE" || code === "SQLITE_CONSTRAINT_PRIMARYKEY";
  }
  return false;
};

const rowToRecord = (row: Record<string, unknown>): RuntimeRecord => ({
  id: String(row.id),
  type: String(row.type),
  occurredAt: DateTime.makeUnsafe(Number(row.occurred_at_ms)) as DateTime.Utc,
  createdAt: DateTime.makeUnsafe(Number(row.created_at_ms)) as DateTime.Utc,
  runId: String(row.run_id),
  processType: String(row.process_type),
  processId: String(row.process_id),
  subjectType: row.subject_type === null || row.subject_type === undefined ? undefined : String(row.subject_type),
  subjectId: row.subject_id === null || row.subject_id === undefined ? undefined : String(row.subject_id),
  key: row.key === null || row.key === undefined ? undefined : String(row.key),
  indexA: row.index_a === null || row.index_a === undefined ? undefined : String(row.index_a),
  indexB: row.index_b === null || row.index_b === undefined ? undefined : String(row.index_b),
  indexC: row.index_c === null || row.index_c === undefined ? undefined : String(row.index_c),
  indexD: row.index_d === null || row.index_d === undefined ? undefined : String(row.index_d),
  indexE: row.index_e === null || row.index_e === undefined ? undefined : String(row.index_e),
  indexF: row.index_f === null || row.index_f === undefined ? undefined : String(row.index_f),
  indexG: row.index_g === null || row.index_g === undefined ? undefined : String(row.index_g),
  indexH: row.index_h === null || row.index_h === undefined ? undefined : String(row.index_h),
  indexNames: parseIndexNames(row.index_names_json === null ? undefined : String(row.index_names_json)),
  payload: parseJsonValue(row.payload_json === null ? undefined : String(row.payload_json)),
  attributes: parseJsonValue(row.attributes_json === null ? undefined : String(row.attributes_json)),
  readonly: Number(row.readonly_int) === 1 ? true : undefined,
});

const encodeRecord = (record: RuntimeRecord) => ({
  id: record.id,
  type: record.type,
  occurred_at_ms: DateTime.toEpochMillis(record.occurredAt),
  created_at_ms: DateTime.toEpochMillis(record.createdAt),
  run_id: record.runId,
  process_type: record.processType,
  process_id: record.processId,
  subject_type: record.subjectType ?? null,
  subject_id: record.subjectId ?? null,
  key: record.key ?? null,
  index_a: record.indexA ?? null,
  index_b: record.indexB ?? null,
  index_c: record.indexC ?? null,
  index_d: record.indexD ?? null,
  index_e: record.indexE ?? null,
  index_f: record.indexF ?? null,
  index_g: record.indexG ?? null,
  index_h: record.indexH ?? null,
  index_names_json: record.indexNames === undefined ? null : JSON.stringify([...record.indexNames]),
  payload_json: record.payload === undefined ? null : JSON.stringify(record.payload),
  attributes_json: record.attributes === undefined ? null : JSON.stringify(record.attributes),
  readonly_int: record.readonly === true ? 1 : 0,
});

const initSchema = (db: Database.Database): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      id TEXT PRIMARY KEY NOT NULL,
      type TEXT NOT NULL,
      occurred_at_ms INTEGER NOT NULL,
      created_at_ms INTEGER NOT NULL,
      run_id TEXT NOT NULL,
      process_type TEXT NOT NULL,
      process_id TEXT NOT NULL,
      subject_type TEXT,
      subject_id TEXT,
      key TEXT,
      index_a TEXT,
      index_b TEXT,
      index_c TEXT,
      index_d TEXT,
      index_e TEXT,
      index_f TEXT,
      index_g TEXT,
      index_h TEXT,
      index_names_json TEXT,
      payload_json TEXT,
      attributes_json TEXT,
      readonly_int INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS ${TABLE}_run_id_idx ON ${TABLE}(run_id);
    CREATE INDEX IF NOT EXISTS ${TABLE}_type_idx ON ${TABLE}(type);
    CREATE INDEX IF NOT EXISTS ${TABLE}_process_idx ON ${TABLE}(process_type, process_id);
    CREATE INDEX IF NOT EXISTS ${TABLE}_subject_idx ON ${TABLE}(subject_type, subject_id);
    CREATE INDEX IF NOT EXISTS ${TABLE}_key_idx ON ${TABLE}(key);
    CREATE INDEX IF NOT EXISTS ${TABLE}_occurred_idx ON ${TABLE}(occurred_at_ms);
    CREATE INDEX IF NOT EXISTS ${TABLE}_created_idx ON ${TABLE}(created_at_ms);
    CREATE INDEX IF NOT EXISTS ${TABLE}_index_a_idx ON ${TABLE}(index_a);
    CREATE INDEX IF NOT EXISTS ${TABLE}_index_b_idx ON ${TABLE}(index_b);
    CREATE INDEX IF NOT EXISTS ${TABLE}_index_c_idx ON ${TABLE}(index_c);
    CREATE INDEX IF NOT EXISTS ${TABLE}_index_d_idx ON ${TABLE}(index_d);
    CREATE INDEX IF NOT EXISTS ${TABLE}_index_e_idx ON ${TABLE}(index_e);
    CREATE INDEX IF NOT EXISTS ${TABLE}_index_f_idx ON ${TABLE}(index_f);
    CREATE INDEX IF NOT EXISTS ${TABLE}_index_g_idx ON ${TABLE}(index_g);
    CREATE INDEX IF NOT EXISTS ${TABLE}_index_h_idx ON ${TABLE}(index_h);
  `);
};

const loadAllRecords = (db: Database.Database): RuntimeRecord[] => {
  const rows = db.prepare(`SELECT * FROM ${TABLE}`).all() as Array<Record<string, unknown>>;
  return rows.map(rowToRecord);
};

const insertRow = (db: Database.Database, record: RuntimeRecord): void => {
  const e = encodeRecord(record);
  db.prepare(
    `INSERT INTO ${TABLE} (
      id, type, occurred_at_ms, created_at_ms, run_id, process_type, process_id,
      subject_type, subject_id, key, index_a, index_b, index_c, index_d, index_e, index_f, index_g, index_h,
      index_names_json, payload_json, attributes_json, readonly_int
    ) VALUES (
      @id, @type, @occurred_at_ms, @created_at_ms, @run_id, @process_type, @process_id,
      @subject_type, @subject_id, @key, @index_a, @index_b, @index_c, @index_d, @index_e, @index_f, @index_g, @index_h,
      @index_names_json, @payload_json, @attributes_json, @readonly_int
    )`,
  ).run(e);
};

const upsertRow = (db: Database.Database, record: RuntimeRecord): void => {
  const e = encodeRecord(record);
  db.prepare(
    `INSERT OR REPLACE INTO ${TABLE} (
      id, type, occurred_at_ms, created_at_ms, run_id, process_type, process_id,
      subject_type, subject_id, key, index_a, index_b, index_c, index_d, index_e, index_f, index_g, index_h,
      index_names_json, payload_json, attributes_json, readonly_int
    ) VALUES (
      @id, @type, @occurred_at_ms, @created_at_ms, @run_id, @process_type, @process_id,
      @subject_type, @subject_id, @key, @index_a, @index_b, @index_c, @index_d, @index_e, @index_f, @index_g, @index_h,
      @index_names_json, @payload_json, @attributes_json, @readonly_int
    )`,
  ).run(e);
};

const deleteById = (db: Database.Database, id: string): void => {
  db.prepare(`DELETE FROM ${TABLE} WHERE id = ?`).run(id);
};

class SqliteRuntimeStorageRowWriteError extends Data.TaggedError("SqliteRuntimeStorageRowWriteError")<{
  readonly cause: unknown;
}> {}

const makeRuntimeStorageService = (db: Database.Database): RuntimeStorageService => ({
  create: (record) =>
    Effect.try({
      try: () => {
        insertRow(db, record);
      },
      catch: (cause) => new SqliteRuntimeStorageRowWriteError({ cause }),
    }).pipe(
      Effect.catchTag("SqliteRuntimeStorageRowWriteError", (e) =>
        isUniqueConstraint(e.cause)
          ? Effect.fail(new RuntimeStorageDuplicateRecordError({ id: record.id }))
          : Effect.die(e.cause),
      ),
    ),
  read: (query) => Effect.sync(() => selectRuntimeRecords(loadAllRecords(db), query)),
  upsert: (record) =>
    Effect.gen(function* () {
      const existing = db.prepare(`SELECT readonly_int FROM ${TABLE} WHERE id = ?`).get(record.id) as
        | { readonly_int: number }
        | undefined;
      if (existing !== undefined && Number(existing.readonly_int) === 1) {
        return yield* new RuntimeStorageReadonlyRecordError({ id: record.id });
      }
      yield* Effect.sync(() => {
        upsertRow(db, record);
      });
    }),
  update: (query, patch) =>
    Effect.sync((): UpdateResult => {
      const matching = selectRuntimeRecords(loadAllRecords(db), query);
      let matched = 0;
      let updated = 0;
      for (const record of matching) {
        matched++;
        if (record.readonly === true) {
          continue;
        }
        upsertRow(db, applyRuntimeRecordPatch(record, patch));
        updated++;
      }
      return { matched, updated };
    }),
  delete: (query) =>
    Effect.sync((): DeleteResult => {
      const includeReadonly = includesReadonlyTrue(query.predicate);
      const matching = selectRuntimeRecords(loadAllRecords(db), query);
      let deleted = 0;
      for (const record of matching) {
        if (record.readonly === true && !includeReadonly) {
          continue;
        }
        deleteById(db, record.id);
        deleted++;
      }
      return { deleted };
    }),
});

/** @public */
export interface SQLiteRuntimeStorageConfig {
  /** Path passed to `better-sqlite3` (for example a temp file or `":memory:"`). */
  readonly filename: string;
  /** Optional open flags forwarded to `better-sqlite3`. */
  readonly options?: Database.Options;
}

/** @public */
export class SQLiteRuntimeStorageOpenError extends Data.TaggedError("SQLiteRuntimeStorageOpenError")<{
  readonly filename: string;
  readonly cause: unknown;
}> {}

const openDatabase = (
  config: SQLiteRuntimeStorageConfig,
): Effect.Effect<Database.Database, SQLiteRuntimeStorageOpenError> =>
  Effect.try({
    try: () => {
      const db = new Database(config.filename, config.options);
      initSchema(db);
      return db;
    },
    catch: (cause) => new SQLiteRuntimeStorageOpenError({ filename: config.filename, cause }),
  });

/** @public */
export const makeRuntimeStorage = (
  config: SQLiteRuntimeStorageConfig,
): Effect.Effect<RuntimeStorageService, SQLiteRuntimeStorageOpenError> =>
  openDatabase(config).pipe(Effect.map(makeRuntimeStorageService));

/**
 * Attach {@link RuntimeStorageService} to an existing `better-sqlite3` handle.
 * Runs migrations idempotently. The caller owns `close()` on the database.
 *
 * @public
 */
export const fromDatabase = (db: Database.Database): RuntimeStorageService => {
  initSchema(db);
  return makeRuntimeStorageService(db);
};

/** @public */
export const layerRuntimeStorage = (
  config: SQLiteRuntimeStorageConfig,
): Layer.Layer<RuntimeStorage, SQLiteRuntimeStorageOpenError, never> =>
  Layer.effect(
    RuntimeStorage,
    Effect.acquireRelease(openDatabase(config), (db) => Effect.sync(() => db.close())).pipe(
      Effect.map(makeRuntimeStorageService),
    ),
  );

/**
 * Facade for the SQLite {@link RuntimeStorageService} adapter.
 *
 * @public
 */
export const SQLiteRuntimeStorage = {
  make: makeRuntimeStorage,
  layer: layerRuntimeStorage,
  fromDatabase,
} as const;

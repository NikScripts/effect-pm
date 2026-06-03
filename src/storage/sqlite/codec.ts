/**
 * Lossless mapping between persisted SQLite rows and {@link RuntimeRecord}.
 * 
 * TODO: Many methods in this module are not written in proper functional style 
 * Effect. We should rewrite them to be more functional.
 *
 * @remarks
 * This module intentionally mirrors the in-memory adapter's **optional field**
 * semantics: missing optional columns become `undefined` on the record, not
 * empty strings. JSON columns use the same `Schema` + `unknownJsonString` bridge
 * as `internal/json` and `ProcessStore` (`encodeJsonLine`), not ad hoc
 * `JSON.parse` / `JSON.stringify`.
 *
 * @module storage/sqlite/codec
 * @internal
 */

import { DateTime, Effect, Option, Schema } from "effect";
import type { RuntimeRecordPredicate } from "../../Query";
import type { JsonValue } from "../../ProcessStoreEvent";
import {
  RuntimeStorageDecodeError,
  RuntimeStorageEncodeError,
  type RuntimeRecord,
} from "../../RuntimeStorage";
import { isJsonValue, unknownJsonString } from "../../internal/json";

/**
 * Parse a JSON text column into {@link JsonValue}, or `undefined` when absent
 * or structurally invalid.
 */
export const parseJsonColumn = (text: string | null | undefined): JsonValue | undefined => {
  if (text === null || text === undefined) {
    return undefined;
  }
  return Option.match(Schema.decodeUnknownOption(unknownJsonString)(text), {
    onNone: () => undefined,
    onSome: (parsed) => (isJsonValue(parsed) ? parsed : undefined),
  });
};

/**
 * Parse `index_names_json` into a string tuple, or `undefined` when absent or
 * invalid (non-string elements are rejected).
 */
export const parseIndexNamesColumn = (text: string | null | undefined): ReadonlyArray<string> | undefined => {
  if (text === null || text === undefined) {
    return undefined;
  }
  return Option.match(Schema.decodeUnknownOption(unknownJsonString)(text), {
    onNone: () => undefined,
    onSome: (parsed) =>
      Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : undefined,
  });
};

// ---------------------------------------------------------------------------
// SQLite row typing (Effect SQL returns loose column bags)
// ---------------------------------------------------------------------------

const readFiniteEpochMillis = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "bigint") {
    const asNumber = Number(value);
    return Number.isFinite(asNumber) ? asNumber : undefined;
  }
  return undefined;
};

const readRequiredEpochMillis = (row: Readonly<Record<string, unknown>>, key: string): number => {
  const value = readFiniteEpochMillis(row[key]);
  if (value === undefined) {
    throw new Error(`SQLiteRuntimeStorage: invalid numeric timestamp column "${key}"`);
  }
  return value;
};

const readOptionalString = (value: unknown): string | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  return String(value);
};

const readRequiredString = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }
  throw new Error("SQLiteRuntimeStorage: invalid required string column");
};

const readRequiredStringColumn = (row: Readonly<Record<string, unknown>>, key: string): string => {
  try {
    return readRequiredString(row[key]);
  } catch {
    throw new Error(`SQLiteRuntimeStorage: invalid required string column "${key}"`);
  }
};

const parseJsonColumnStrict = (text: string | null | undefined, key: string): JsonValue | undefined => {
  const parsed = parseJsonColumn(text);
  if (parsed === undefined && text !== null && text !== undefined) {
    throw new Error(`SQLiteRuntimeStorage: invalid JSON column "${key}"`);
  }
  return parsed;
};

const parseIndexNamesColumnStrict = (text: string | null | undefined): ReadonlyArray<string> | undefined => {
  const parsed = parseIndexNamesColumn(text);
  if (parsed === undefined && text !== null && text !== undefined) {
    throw new Error("SQLiteRuntimeStorage: invalid index_names_json column");
  }
  return parsed;
};

/**
 * Convert a single SQL row bag into a {@link RuntimeRecord}.
 *
 * @remarks
 * Epoch millis are interpreted as UTC instants via {@link DateTime.makeUnsafe}.
 * Corrupt adapter-owned rows fail fast; silently fabricating defaults would make
 * storage corruption look like legitimate runtime data.
 */
export const decodeRuntimeRecordRow = (row: Readonly<Record<string, unknown>>): RuntimeRecord => {
  const occurredMs = readRequiredEpochMillis(row, "occurred_at_ms");
  const createdMs = readRequiredEpochMillis(row, "created_at_ms");
  const occurredAt = DateTime.makeUnsafe(occurredMs);
  const createdAt = DateTime.makeUnsafe(createdMs);
  const indexNamesRaw = row["index_names_json"];
  const indexNamesText =
    indexNamesRaw === null || indexNamesRaw === undefined ? undefined : String(indexNamesRaw);
  const payloadRaw = row["payload_json"];
  const payloadText = payloadRaw === null || payloadRaw === undefined ? undefined : String(payloadRaw);
  const attributesRaw = row["attributes_json"];
  const attributesText =
    attributesRaw === null || attributesRaw === undefined ? undefined : String(attributesRaw);
  const readonlyInt = row["readonly_int"];
  const readonlyFlag =
    readonlyInt === null || readonlyInt === undefined ? undefined : Number(readonlyInt) === 1;

  return {
    id: readRequiredStringColumn(row, "id"),
    type: readRequiredStringColumn(row, "type"),
    occurredAt: DateTime.isUtc(occurredAt) ? occurredAt : DateTime.toUtc(occurredAt),
    createdAt: DateTime.isUtc(createdAt) ? createdAt : DateTime.toUtc(createdAt),
    runId: readRequiredStringColumn(row, "run_id"),
    processType: readRequiredStringColumn(row, "process_type"),
    processId: readRequiredStringColumn(row, "process_id"),
    subjectType: readOptionalString(row["subject_type"]),
    subjectId: readOptionalString(row["subject_id"]),
    key: readOptionalString(row["key"]),
    indexA: readOptionalString(row["index_a"]),
    indexB: readOptionalString(row["index_b"]),
    indexC: readOptionalString(row["index_c"]),
    indexD: readOptionalString(row["index_d"]),
    indexE: readOptionalString(row["index_e"]),
    indexF: readOptionalString(row["index_f"]),
    indexG: readOptionalString(row["index_g"]),
    indexH: readOptionalString(row["index_h"]),
    indexNames: parseIndexNamesColumnStrict(indexNamesText),
    payload: parseJsonColumnStrict(payloadText, "payload_json"),
    attributes: parseJsonColumnStrict(attributesText, "attributes_json"),
    readonly: readonlyFlag,
  };
};

/**
 * {@link decodeRuntimeRecordRow} wrapped with {@link Effect.sync} so callers
 * compose row materialization on the same `Effect` algebra as SQL reads.
 */
export const decodeRuntimeRecordRowEffect = (
  row: Readonly<Record<string, unknown>>,
): Effect.Effect<RuntimeRecord, RuntimeStorageDecodeError, never> =>
  Effect.try({
    try: () => decodeRuntimeRecordRow(row),
    catch: (cause) =>
      new RuntimeStorageDecodeError({
        adapter: "sqlite",
        operation: "read",
        id: typeof row["id"] === "string" ? row["id"] : undefined,
        cause,
        detail: "Failed to decode runtime_records row",
      }),
  });

const encodeUnknownToJsonString = (
  field: string,
  value: unknown,
): Effect.Effect<string, RuntimeStorageEncodeError, never> =>
  Schema.encodeUnknownEffect(unknownJsonString)(value).pipe(
    Effect.mapError((cause) =>
      new RuntimeStorageEncodeError({
        adapter: "sqlite",
        operation: "encode",
        field,
        cause,
        detail: `Failed to encode ${field} as JSON text`,
      })
    ),
  );

/** Parameter object for SQLite insert helpers. */
export interface RuntimeRecordInsertParams {
  readonly id: string;
  readonly type: string;
  readonly occurred_at_ms: number;
  readonly created_at_ms: number;
  readonly run_id: string;
  readonly process_type: string;
  readonly process_id: string;
  readonly subject_type: string | null;
  readonly subject_id: string | null;
  readonly key: string | null;
  readonly index_a: string | null;
  readonly index_b: string | null;
  readonly index_c: string | null;
  readonly index_d: string | null;
  readonly index_e: string | null;
  readonly index_f: string | null;
  readonly index_g: string | null;
  readonly index_h: string | null;
  readonly index_names_json: string | null;
  readonly payload_json: string | null;
  readonly attributes_json: string | null;
  readonly readonly_int: 0 | 1 | null;
}

/**
 * Encode a runtime record for persistence. Optional fields become SQL `NULL`
 * rather than empty strings, matching {@link RuntimeStorage.memory} optional
 * semantics.
 *
 * @remarks
 * JSON columns use {@link Schema.encodeUnknownEffect} with {@link unknownJsonString},
 * matching {@link ProcessStore} line encoding (`encodeJsonLine`).
 */
export const encodeRuntimeRecordParamsEffect = (
  record: RuntimeRecord,
): Effect.Effect<RuntimeRecordInsertParams, RuntimeStorageEncodeError, never> =>
  Effect.gen(function* () {
    const index_names_json =
      record.indexNames === undefined ? null : yield* encodeUnknownToJsonString("indexNames", [...record.indexNames]);
    const payload_json =
      record.payload === undefined ? null : yield* encodeUnknownToJsonString("payload", record.payload);
    const attributes_json =
      record.attributes === undefined ? null : yield* encodeUnknownToJsonString("attributes", record.attributes);

    return {
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
      index_names_json,
      payload_json,
      attributes_json,
      readonly_int: record.readonly === undefined ? null : record.readonly === true ? 1 : 0,
    };
  });

// ---------------------------------------------------------------------------
// Predicate helpers (must stay aligned with `RuntimeStorage.ts`)
// ---------------------------------------------------------------------------

/**
 * Detects whether a predicate explicitly requires `readonly === true`, which
 * opts deletes into touching immutable rows (see adapter guide).
 */
export const predicateIncludesReadonlyTrue = (
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
      return predicate.predicates.some(predicateIncludesReadonlyTrue);
    default:
      return false;
  }
};

/**
 * Lossless mapping between persisted SQLite rows and {@link RuntimeRecord}.
 *
 * @remarks
 * This module intentionally mirrors the in-memory adapter's **optional field**
 * semantics: missing optional columns become `undefined` on the record, not
 * empty strings. JSON columns are validated structurally on read so a corrupted
 * local row cannot deserialize into a non-`JsonValue` tree.
 *
 * @module storage/sqlite/codec
 * @internal
 */

import { DateTime, Option } from "effect";
import type { RuntimeRecordPredicate } from "../../Query";
import type { JsonValue } from "../../ProcessStoreEvent";
import type { RuntimeRecord } from "../../RuntimeStorage";

// ---------------------------------------------------------------------------
// JSON narrowing (structural, mirrors `JsonValue` recursion)
// ---------------------------------------------------------------------------

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

const jsonParse = Option.liftThrowable(JSON.parse);

/**
 * Parse a JSON text column into {@link JsonValue}, or `undefined` when absent
 * or structurally invalid.
 */
export const parseJsonColumn = (text: string | null | undefined): JsonValue | undefined => {
  if (text === null || text === undefined) {
    return undefined;
  }
  const parsed = Option.getOrUndefined(jsonParse(text));
  return parsed !== undefined && isJsonValue(parsed) ? parsed : undefined;
};

/**
 * Parse `index_names_json` into a string tuple, or `undefined` when absent or
 * invalid (non-string elements are rejected).
 */
export const parseIndexNamesColumn = (text: string | null | undefined): ReadonlyArray<string> | undefined => {
  if (text === null || text === undefined) {
    return undefined;
  }
  const parsed = Option.getOrUndefined(jsonParse(text));
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    return undefined;
  }
  return parsed;
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
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
};

/**
 * Convert a single SQL row bag into a {@link RuntimeRecord}.
 *
 * @remarks
 * Epoch millis are interpreted as UTC instants via {@link DateTime.makeUnsafe}.
 * If a row is partially corrupt (for example non-numeric timestamps), this
 * still returns a **best-effort** record so callers can surface diagnostics;
 * tests cover the happy path; production data should always be written through
 * this adapter's encoder.
 */
export const decodeRuntimeRecordRow = (row: Readonly<Record<string, unknown>>): RuntimeRecord => {
  const occurredMs = readFiniteEpochMillis(row["occurred_at_ms"]) ?? 0;
  const createdMs = readFiniteEpochMillis(row["created_at_ms"]) ?? 0;
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
    readonlyInt === null || readonlyInt === undefined ? false : Number(readonlyInt) === 1;

  return {
    id: readRequiredString(row["id"]),
    type: readRequiredString(row["type"]),
    occurredAt: DateTime.isUtc(occurredAt) ? occurredAt : DateTime.toUtc(occurredAt),
    createdAt: DateTime.isUtc(createdAt) ? createdAt : DateTime.toUtc(createdAt),
    runId: readRequiredString(row["run_id"]),
    processType: readRequiredString(row["process_type"]),
    processId: readRequiredString(row["process_id"]),
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
    indexNames: parseIndexNamesColumn(indexNamesText),
    payload: parseJsonColumn(payloadText),
    attributes: parseJsonColumn(attributesText),
    readonly: readonlyFlag ? true : undefined,
  };
};

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
  readonly readonly_int: 0 | 1;
}

/**
 * Encode a runtime record for persistence. Optional fields become SQL `NULL`
 * rather than empty strings, matching {@link RuntimeStorage.memory} optional
 * semantics.
 */
export const encodeRuntimeRecordParams = (record: RuntimeRecord): RuntimeRecordInsertParams => ({
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
    case "Xor":
      return predicate.predicates.some(predicateIncludesReadonlyTrue);
    default:
      return false;
  }
};

/**
 * JSON encoding for {@link RuntimeRecord} rows stored in Redis.
 *
 * @module storage/redis/codec
 * @internal
 */

import { DateTime, Effect, Schema } from "effect";
import type { JsonValue } from "../../ProcessStoreEvent";
import {
  RuntimeStorageDecodeError,
  RuntimeStorageEncodeError,
  type RuntimeRecord,
} from "../../RuntimeStorage";
import { isJsonValue, unknownJsonString } from "../../internal/json";

interface PersistedRuntimeRecord {
  readonly id: string;
  readonly type: string;
  readonly occurredAtMs: number;
  readonly createdAtMs: number;
  readonly runId: string;
  readonly processType: string;
  readonly processId: string;
  readonly subjectType?: string;
  readonly subjectId?: string;
  readonly key?: string;
  readonly indexA?: string;
  readonly indexB?: string;
  readonly indexC?: string;
  readonly indexD?: string;
  readonly indexE?: string;
  readonly indexF?: string;
  readonly indexG?: string;
  readonly indexH?: string;
  readonly indexNames?: ReadonlyArray<string>;
  readonly payload?: JsonValue;
  readonly attributes?: JsonValue;
  readonly readonly?: boolean;
}

const readOptionalString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const readIndexNames = (value: unknown): ReadonlyArray<string> | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;

const parseJsonField = (value: unknown): JsonValue | undefined =>
  isJsonValue(value) ? value : undefined;

export const encodeRuntimeRecordJson = (
  record: RuntimeRecord,
): Effect.Effect<string, RuntimeStorageEncodeError, never> => {
  const persisted: PersistedRuntimeRecord = {
    id: record.id,
    type: record.type,
    occurredAtMs: DateTime.toEpochMillis(record.occurredAt),
    createdAtMs: DateTime.toEpochMillis(record.createdAt),
    runId: record.runId,
    processType: record.processType,
    processId: record.processId,
    subjectType: record.subjectType,
    subjectId: record.subjectId,
    key: record.key,
    indexA: record.indexA,
    indexB: record.indexB,
    indexC: record.indexC,
    indexD: record.indexD,
    indexE: record.indexE,
    indexF: record.indexF,
    indexG: record.indexG,
    indexH: record.indexH,
    indexNames: record.indexNames,
    payload: record.payload,
    attributes: record.attributes,
    readonly: record.readonly,
  };
  return Schema.encodeUnknownEffect(unknownJsonString)(persisted).pipe(
    Effect.mapError((cause) =>
      new RuntimeStorageEncodeError({
        adapter: "redis",
        operation: "encode",
        cause,
        detail: "Failed to encode runtime record as JSON",
      }),
    ),
  );
};

export const decodeRuntimeRecordJson = (
  text: string,
  id?: string,
): Effect.Effect<RuntimeRecord, RuntimeStorageDecodeError, never> =>
  Effect.gen(function* () {
    const parsed = yield* Schema.decodeUnknownEffect(unknownJsonString)(text).pipe(
      Effect.mapError((cause) =>
        new RuntimeStorageDecodeError({
          adapter: "redis",
          operation: "read",
          id,
          cause,
          detail: "Failed to parse runtime record JSON",
        }),
      ),
    );
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return yield* new RuntimeStorageDecodeError({
        adapter: "redis",
        operation: "read",
        id,
        detail: "Runtime record JSON must be an object",
      });
    }
    const row = parsed as Record<string, unknown>;
    const occurredAtMs = row["occurredAtMs"];
    const createdAtMs = row["createdAtMs"];
    if (typeof occurredAtMs !== "number" || typeof createdAtMs !== "number") {
      return yield* new RuntimeStorageDecodeError({
        adapter: "redis",
        operation: "read",
        id,
        field: "occurredAtMs",
        detail: "Missing or invalid timestamp fields",
      });
    }
    const recordId = readOptionalString(row["id"]) ?? id;
    if (recordId === undefined) {
      return yield* new RuntimeStorageDecodeError({
        adapter: "redis",
        operation: "read",
        detail: "Missing record id",
      });
    }
    const type = readOptionalString(row["type"]);
    const runId = readOptionalString(row["runId"]);
    const processType = readOptionalString(row["processType"]);
    const processId = readOptionalString(row["processId"]);
    if (type === undefined || runId === undefined || processType === undefined || processId === undefined) {
      return yield* new RuntimeStorageDecodeError({
        adapter: "redis",
        operation: "read",
        id: recordId,
        detail: "Missing required runtime record fields",
      });
    }
    const occurredAt = DateTime.makeUnsafe(occurredAtMs);
    const createdAt = DateTime.makeUnsafe(createdAtMs);
    return {
      id: recordId,
      type,
      occurredAt: DateTime.isUtc(occurredAt) ? occurredAt : DateTime.toUtc(occurredAt),
      createdAt: DateTime.isUtc(createdAt) ? createdAt : DateTime.toUtc(createdAt),
      runId,
      processType,
      processId,
      subjectType: readOptionalString(row["subjectType"]),
      subjectId: readOptionalString(row["subjectId"]),
      key: readOptionalString(row["key"]),
      indexA: readOptionalString(row["indexA"]),
      indexB: readOptionalString(row["indexB"]),
      indexC: readOptionalString(row["indexC"]),
      indexD: readOptionalString(row["indexD"]),
      indexE: readOptionalString(row["indexE"]),
      indexF: readOptionalString(row["indexF"]),
      indexG: readOptionalString(row["indexG"]),
      indexH: readOptionalString(row["indexH"]),
      indexNames: readIndexNames(row["indexNames"]),
      payload: parseJsonField(row["payload"]),
      attributes: parseJsonField(row["attributes"]),
      readonly: row["readonly"] === true ? true : undefined,
    } satisfies RuntimeRecord;
  });

export const parseSmemberIds = (reply: unknown): ReadonlyArray<string> => {
  if (!Array.isArray(reply)) {
    return [];
  }
  return reply.filter((item): item is string => typeof item === "string");
};

export const parseExists = (reply: unknown): boolean => {
  if (typeof reply === "number") {
    return reply > 0;
  }
  if (typeof reply === "string") {
    const parsed = Number(reply);
    return Number.isFinite(parsed) && parsed > 0;
  }
  return false;
};

export const parseSetNxOk = (reply: unknown): boolean =>
  reply === "OK" || reply === 1 || reply === true;

export const parseOptionalStringReply = (reply: unknown): string | undefined => {
  if (reply === null || reply === undefined) {
    return undefined;
  }
  if (typeof reply === "string") {
    return reply;
  }
  return undefined;
};

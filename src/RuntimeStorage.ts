/**
 * Generic storage port for normalized runtime records.
 *
 * @module RuntimeStorage
 */

import { Context, Data, DateTime, Effect, Layer } from "effect";
import type {
  RuntimeRecordPatch,
  RuntimeRecordPredicate,
  RuntimeRecordQuery,
} from "./Query";
import type { JsonValue } from "./ProcessStoreEvent";

/** @public */
export interface RuntimeRecord {
  readonly id: string;
  readonly type: string;
  readonly occurredAt: DateTime.Utc;
  readonly createdAt: DateTime.Utc;
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

/** @public */
export interface UpdateResult {
  readonly matched: number;
  readonly updated: number;
}

/** @public */
export interface DeleteResult {
  readonly deleted: number;
}

/** @public */
export class RuntimeStorageDuplicateRecordError extends Data.TaggedError(
  "RuntimeStorageDuplicateRecordError",
)<{
  readonly id: string;
}> {}

/** @public */
export class RuntimeStorageReadonlyRecordError extends Data.TaggedError(
  "RuntimeStorageReadonlyRecordError",
)<{
  readonly id: string;
}> {}

/** @public */
export type RuntimeStorageError =
  | RuntimeStorageDuplicateRecordError
  | RuntimeStorageReadonlyRecordError;

/** @public */
export interface RuntimeStorageService {
  readonly create: (
    record: RuntimeRecord,
  ) => Effect.Effect<void, RuntimeStorageDuplicateRecordError>;
  readonly read: (
    query?: RuntimeRecordQuery,
  ) => Effect.Effect<RuntimeRecord[]>;
  readonly upsert: (
    record: RuntimeRecord,
  ) => Effect.Effect<void, RuntimeStorageReadonlyRecordError>;
  readonly update: (
    query: RuntimeRecordQuery,
    patch: RuntimeRecordPatch,
  ) => Effect.Effect<UpdateResult>;
  readonly delete: (
    query: RuntimeRecordQuery,
  ) => Effect.Effect<DeleteResult>;
}

const fieldValue = (
  record: RuntimeRecord,
  field: string,
): string | boolean | undefined => {
  switch (field) {
    case "id":
      return record.id;
    case "type":
      return record.type;
    case "runId":
      return record.runId;
    case "processType":
      return record.processType;
    case "processId":
      return record.processId;
    case "subjectType":
      return record.subjectType;
    case "subjectId":
      return record.subjectId;
    case "key":
      return record.key;
    case "indexA":
      return record.indexA;
    case "indexB":
      return record.indexB;
    case "indexC":
      return record.indexC;
    case "indexD":
      return record.indexD;
    case "indexE":
      return record.indexE;
    case "indexF":
      return record.indexF;
    case "indexG":
      return record.indexG;
    case "indexH":
      return record.indexH;
    case "readonly":
      return record.readonly;
    default:
      return undefined;
  }
};

const dateFieldValue = (
  record: RuntimeRecord,
  field: "occurredAt" | "createdAt",
): DateTime.Utc => field === "occurredAt" ? record.occurredAt : record.createdAt;

const compareDate = (left: DateTime.Utc, right: DateTime.Utc): number =>
  DateTime.toEpochMillis(left) - DateTime.toEpochMillis(right);

const matchesPredicate = (
  record: RuntimeRecord,
  predicate: RuntimeRecordPredicate | undefined,
): boolean => {
  if (predicate === undefined) {
    return true;
  }

  switch (predicate._tag) {
    case "Equals":
      return fieldValue(record, predicate.field) === predicate.value;
    case "NotEquals":
      return fieldValue(record, predicate.field) !== predicate.value;
    case "In":
      return predicate.values.includes(fieldValue(record, predicate.field) ?? "");
    case "IsNull":
      return fieldValue(record, predicate.field) === undefined;
    case "IsNotNull":
      return fieldValue(record, predicate.field) !== undefined;
    case "After":
      return compareDate(dateFieldValue(record, predicate.field), predicate.value) > 0;
    case "Before":
      return compareDate(dateFieldValue(record, predicate.field), predicate.value) < 0;
    case "Between": {
      const value = dateFieldValue(record, predicate.field);
      return compareDate(value, predicate.start) > 0 &&
        compareDate(value, predicate.end) < 0;
    }
    case "And":
      return predicate.predicates.every((item) => matchesPredicate(record, item));
    case "Or":
      return predicate.predicates.some((item) => matchesPredicate(record, item));
    case "Xor":
      return predicate.predicates.filter((item) => matchesPredicate(record, item)).length === 1;
  }
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

const ordered = (
  rows: ReadonlyArray<RuntimeRecord>,
  query: RuntimeRecordQuery | undefined,
): RuntimeRecord[] => {
  const orderBy = query?.orderBy ?? [{ field: "occurredAt" as const, direction: "desc" as const }];
  return [...rows].sort((left, right) => {
    for (const order of orderBy) {
      const direction = order.direction === "asc" ? 1 : -1;
      const comparison = order.field === "occurredAt" || order.field === "createdAt"
        ? compareDate(dateFieldValue(left, order.field), dateFieldValue(right, order.field))
        : String(fieldValue(left, order.field) ?? "").localeCompare(
            String(fieldValue(right, order.field) ?? ""),
          );
      if (comparison !== 0) {
        return comparison * direction;
      }
    }
    return 0;
  });
};

const applyWindow = (
  rows: ReadonlyArray<RuntimeRecord>,
  query: RuntimeRecordQuery | undefined,
): RuntimeRecord[] => {
  const offset = Math.max(0, query?.offset ?? 0);
  const limited = rows.slice(offset);
  return query?.limit === undefined
    ? limited
    : limited.slice(0, Math.max(0, query.limit));
};

/** @internal */
export const selectRuntimeRecords = (
  rows: ReadonlyArray<RuntimeRecord>,
  query: RuntimeRecordQuery | undefined,
): RuntimeRecord[] =>
  applyWindow(
    ordered(
      rows.filter((record) => matchesPredicate(record, query?.predicate)),
      query,
    ),
    query,
  );

/** @internal */
export const applyRuntimeRecordPatch = (
  record: RuntimeRecord,
  patch: RuntimeRecordPatch,
): RuntimeRecord =>
  ({
    id: record.id,
    type: patch.type ?? record.type,
    occurredAt: patch.occurredAt ?? record.occurredAt,
    createdAt: record.createdAt,
    runId: patch.runId ?? record.runId,
    processType: patch.processType ?? record.processType,
    processId: patch.processId ?? record.processId,
    subjectType: patch.subjectType === null ? undefined : patch.subjectType ?? record.subjectType,
    subjectId: patch.subjectId === null ? undefined : patch.subjectId ?? record.subjectId,
    key: patch.key === null ? undefined : patch.key ?? record.key,
    indexA: patch.indexA === null ? undefined : patch.indexA ?? record.indexA,
    indexB: patch.indexB === null ? undefined : patch.indexB ?? record.indexB,
    indexC: patch.indexC === null ? undefined : patch.indexC ?? record.indexC,
    indexD: patch.indexD === null ? undefined : patch.indexD ?? record.indexD,
    indexE: patch.indexE === null ? undefined : patch.indexE ?? record.indexE,
    indexF: patch.indexF === null ? undefined : patch.indexF ?? record.indexF,
    indexG: patch.indexG === null ? undefined : patch.indexG ?? record.indexG,
    indexH: patch.indexH === null ? undefined : patch.indexH ?? record.indexH,
    indexNames: patch.indexNames === null ? undefined : patch.indexNames ?? record.indexNames,
    payload: patch.payload === null ? undefined : patch.payload ?? record.payload,
    attributes: patch.attributes === null ? undefined : patch.attributes ?? record.attributes,
    readonly: record.readonly,
  });

const makeInMemoryRuntimeStorage: Effect.Effect<
  RuntimeStorageService,
  never,
  never
> = Effect.sync(() => {
  const records = new Map<string, RuntimeRecord>();

  return {
    create: (record) =>
      records.has(record.id)
        ? Effect.fail(new RuntimeStorageDuplicateRecordError({ id: record.id }))
        : Effect.sync(() => {
            records.set(record.id, record);
          }),
    read: (query) =>
      Effect.sync(() => selectRuntimeRecords([...records.values()], query)),
    upsert: (record) =>
      records.get(record.id)?.readonly === true
        ? Effect.fail(new RuntimeStorageReadonlyRecordError({ id: record.id }))
        : Effect.sync(() => {
            records.set(record.id, record);
          }),
    update: (query, patch) =>
      Effect.sync(() => {
        let matched = 0;
        let updated = 0;
        for (const record of selectRuntimeRecords([...records.values()], query)) {
          matched++;
          if (record.readonly === true) {
            continue;
          }
          records.set(record.id, applyRuntimeRecordPatch(record, patch));
          updated++;
        }
        return { matched, updated };
      }),
    delete: (query) =>
      Effect.sync(() => {
        let deleted = 0;
        const includeReadonly = includesReadonlyTrue(query.predicate);
        for (const record of selectRuntimeRecords([...records.values()], query)) {
          if (record.readonly === true && !includeReadonly) {
            continue;
          }
          if (records.delete(record.id)) {
            deleted++;
          }
        }
        return { deleted };
      }),
  };
});

/** @public */
export class RuntimeStorage extends Context.Service<
  RuntimeStorage,
  RuntimeStorageService
>()("@nikscripts/effect-pm/RuntimeStorage", {
  make: makeInMemoryRuntimeStorage,
}) {}

export namespace RuntimeStorage {
  /** @public */
  export const memory = makeInMemoryRuntimeStorage;

  /** @public */
  export const layer = Layer.effect(RuntimeStorage, makeInMemoryRuntimeStorage);
}

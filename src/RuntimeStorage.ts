/**
 * **RuntimeStorage** — generic, swappable persistence layer for the
 * effect-pm package.
 *
 * @remarks
 * Storage adapters (in-memory, SQLite, future Prisma…) implement
 * {@link RuntimeStorageService} and yield through the
 * {@link RuntimeStorage} service tag. Per-domain storage facets in
 * `src/store/*` (queue, run-resource, process lifecycle, …) build their
 * concrete read/write APIs on top of this generic record shape; the
 * adapters never speak facet vocabulary.
 *
 * The single normalized {@link RuntimeRecord} row carries a small fixed
 * set of indexed columns plus a generic `payload` JSON blob. Facets pick
 * which columns they need (and document what `processType`,
 * `subjectType`, `key`, `indexA-H` mean for their wire types — see
 * `src/store/queueResource.ts` for a worked example).
 *
 * Error channels distinguish logical storage outcomes from operational durable
 * failures. Duplicate ids and readonly rows are logical contract failures.
 * Connection, schema, query, decode, transaction, and availability failures are
 * operational errors shared by durable adapters such as SQLite and Prisma.
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

/**
 * Normalized row stored by every {@link RuntimeStorageService}.
 *
 * @remarks
 * Facet writers fill in only the fields they need. The shape is
 * intentionally minimal: small fixed columns for the things storage
 * needs to **index** and **query** (process / subject / type / key
 * / time), plus an opaque JSON `payload` for everything domain-specific.
 *
 * @public
 */
export interface RuntimeRecord {
  /** Globally-unique id (per-facet convention; storage rejects duplicates). */
  readonly id: string;
  /** Facet-defined wire type, e.g. `queue.entry.enqueued`. Indexed. */
  readonly type: string;
  /** When the recorded event happened in domain time. Indexed for sorting. */
  readonly occurredAt: DateTime.Utc;
  /** When storage observed the row (set by the spine, not the writer). */
  readonly createdAt: DateTime.Utc;
  /** Stable per-layer run id stamped by the spine for trace correlation. */
  readonly runId: string;
  /** Process category, e.g. `queue-resource` / `run-resource` / `process`. Indexed. */
  readonly processType: string;
  /** Process identity within `processType`, e.g. queueId / resourceId / processId. Indexed. */
  readonly processId: string;
  /** Optional sub-domain, e.g. `queue-entry` / `queue-lifecycle` / `queue-dedupe-key`. Indexed. */
  readonly subjectType?: string;
  /** Identity within `subjectType`, e.g. an entryId or a dedupe key. Indexed. */
  readonly subjectId?: string;
  /** Free-form indexed string used for fast lookups (e.g. queue dedupe key). */
  readonly key?: string;
  /** Generic indexed string slot. Reserved for facet-specific use; see `indexNames`. */
  readonly indexA?: string;
  /** Generic indexed string slot. Reserved for facet-specific use; see `indexNames`. */
  readonly indexB?: string;
  /** Generic indexed string slot. Reserved for facet-specific use; see `indexNames`. */
  readonly indexC?: string;
  /** Generic indexed string slot. Reserved for facet-specific use; see `indexNames`. */
  readonly indexD?: string;
  /** Generic indexed string slot. Reserved for facet-specific use; see `indexNames`. */
  readonly indexE?: string;
  /** Generic indexed string slot. Reserved for facet-specific use; see `indexNames`. */
  readonly indexF?: string;
  /** Generic indexed string slot. Reserved for facet-specific use; see `indexNames`. */
  readonly indexG?: string;
  /** Generic indexed string slot. Reserved for facet-specific use; see `indexNames`. */
  readonly indexH?: string;
  /** Names of the populated `indexA-H` slots, for adapter introspection. */
  readonly indexNames?: ReadonlyArray<string>;
  /** Domain-shaped JSON payload owned by the facet's codec. Not indexed. */
  readonly payload?: JsonValue;
  /** Free-form attributes (e.g. `groupId`, correlation ids). Not indexed. */
  readonly attributes?: JsonValue;
  /** When `true` the row rejects updates and bulk deletes. */
  readonly readonly?: boolean;
}

/**
 * Result of {@link RuntimeStorageService.update}.
 *
 * @public
 */
export interface UpdateResult {
  /** Number of rows that matched the query. */
  readonly matched: number;
  /** Number of rows that were actually mutated (excludes readonly hits). */
  readonly updated: number;
}

/**
 * Result of {@link RuntimeStorageService.delete}.
 *
 * @public
 */
export interface DeleteResult {
  /** Number of rows that were removed. */
  readonly deleted: number;
}

/**
 * Failed `create` because a row with the same `id` already exists.
 *
 * @public
 */
export class RuntimeStorageDuplicateRecordError extends Data.TaggedError(
  "RuntimeStorageDuplicateRecordError",
)<{
  readonly id: string;
}> {}

/**
 * Failed write (`upsert` / `update`) on a row marked `readonly: true`.
 *
 * @public
 */
export class RuntimeStorageReadonlyRecordError extends Data.TaggedError(
  "RuntimeStorageReadonlyRecordError",
)<{
  readonly id: string;
}> {}

/**
 * Storage adapter name reported by operational failures.
 *
 * @public
 */
export type RuntimeStorageAdapter = "memory" | "sqlite" | "prisma" | (string & {});

/**
 * Runtime storage operation that encountered an operational failure.
 *
 * @public
 */
export type RuntimeStorageOperation =
  | "bootstrap"
  | "create"
  | "read"
  | "upsert"
  | "update"
  | "delete"
  | "transaction";

/**
 * Common metadata carried by RuntimeStorage operational failures.
 *
 * @public
 */
export interface RuntimeStorageOperationalFields {
  readonly adapter: RuntimeStorageAdapter;
  readonly operation: RuntimeStorageOperation;
  readonly cause?: unknown;
  readonly detail?: string;
}

/**
 * Storage driver connection, file, network, or availability failure.
 *
 * @public
 */
export class RuntimeStorageConnectionError extends Data.TaggedError(
  "RuntimeStorageConnectionError",
)<RuntimeStorageOperationalFields> {}

/**
 * Missing or incompatible durable storage schema.
 *
 * @public
 */
export class RuntimeStorageSchemaError extends Data.TaggedError(
  "RuntimeStorageSchemaError",
)<RuntimeStorageOperationalFields> {}

/**
 * Query or mutation failed after the adapter was acquired.
 *
 * @public
 */
export class RuntimeStorageQueryError extends Data.TaggedError(
  "RuntimeStorageQueryError",
)<RuntimeStorageOperationalFields> {}

/**
 * Transactional write failed.
 *
 * @public
 */
export class RuntimeStorageTransactionError extends Data.TaggedError(
  "RuntimeStorageTransactionError",
)<RuntimeStorageOperationalFields> {}

/**
 * Adapter is temporarily unavailable.
 *
 * @public
 */
export class RuntimeStorageUnavailableError extends Data.TaggedError(
  "RuntimeStorageUnavailableError",
)<RuntimeStorageOperationalFields> {}

/**
 * A persisted row could not be decoded as a {@link RuntimeRecord}.
 *
 * @public
 */
export class RuntimeStorageDecodeError extends Data.TaggedError(
  "RuntimeStorageDecodeError",
)<RuntimeStorageOperationalFields & {
  readonly id?: string;
  readonly field?: string;
}> {}

/**
 * Logical storage contract failures.
 *
 * @public
 */
export type RuntimeStorageLogicalError =
  | RuntimeStorageDuplicateRecordError
  | RuntimeStorageReadonlyRecordError;

/**
 * Durable adapter operational failures.
 *
 * @public
 */
export type RuntimeStorageOperationalError =
  | RuntimeStorageConnectionError
  | RuntimeStorageSchemaError
  | RuntimeStorageQueryError
  | RuntimeStorageDecodeError
  | RuntimeStorageTransactionError
  | RuntimeStorageUnavailableError;

/**
 * Closed union of every typed error that {@link RuntimeStorageService}
 * exposes. Adapters must not surface adapter-specific driver failures directly.
 *
 * @public
 */
export type RuntimeStorageError =
  | RuntimeStorageLogicalError
  | RuntimeStorageOperationalError;

/**
 * The contract that every {@link RuntimeStorage} adapter implements.
 *
 * Adapters operate on generic {@link RuntimeRecord} rows. They never
 * decode payloads, mint identifiers, or know what `processType` means
 * — that lives in the per-domain facets in `src/store/*`.
 *
 * @public
 */
export interface RuntimeStorageService {
  /** Insert one row. Fails if `record.id` already exists. */
  readonly create: (
    record: RuntimeRecord,
  ) => Effect.Effect<void, RuntimeStorageDuplicateRecordError | RuntimeStorageOperationalError>;
  /** Read rows matching a query. Defaults to all rows ordered by `occurredAt` desc. */
  readonly read: (
    query?: RuntimeRecordQuery,
  ) => Effect.Effect<RuntimeRecord[], RuntimeStorageOperationalError>;
  /** Insert-or-replace one row. Fails if the existing row is readonly. */
  readonly upsert: (
    record: RuntimeRecord,
  ) => Effect.Effect<void, RuntimeStorageReadonlyRecordError | RuntimeStorageOperationalError>;
  /** Patch matching rows (skipping readonly ones). Returns matched/updated counts. */
  readonly update: (
    query: RuntimeRecordQuery,
    patch: RuntimeRecordPatch,
  ) => Effect.Effect<UpdateResult, RuntimeStorageOperationalError>;
  /** Delete matching rows. Readonly rows are skipped unless `readonly: true` is in the predicate. */
  readonly delete: (
    query: RuntimeRecordQuery,
  ) => Effect.Effect<DeleteResult, RuntimeStorageOperationalError>;
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
      return predicate.predicates.length > 0 &&
        predicate.predicates.every((item) => matchesPredicate(record, item));
    case "Or":
      return predicate.predicates.some((item) => matchesPredicate(record, item));
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

/**
 * Service tag for {@link RuntimeStorageService}.
 *
 * Apps compose a concrete adapter (e.g. `layerProcessStore` from
 * `@nikscripts/effect-pm/storage/sqlite`); facets in `src/store/*` yield
 * this tag through their `*.layerRuntimeStorage` layer to obtain a spine.
 *
 * @public
 */
export class RuntimeStorage extends Context.Service<
  RuntimeStorage,
  RuntimeStorageService
>()("@nikscripts/effect-pm/RuntimeStorage", {
  make: makeInMemoryRuntimeStorage,
}) {}

export namespace RuntimeStorage {
  /**
   * In-memory {@link RuntimeStorageService} factory. Each invocation
   * returns a fresh, isolated `Map`-backed implementation — useful for
   * tests that want explicit control over storage lifetime.
   *
   * @public
   */
  export const memory = makeInMemoryRuntimeStorage;

  /**
   * Shared in-memory {@link RuntimeStorage} layer. Suitable for dev /
   * tests / examples; for durable storage use
   * `layerProcessStore({ filename })` from
   * `@nikscripts/effect-pm/storage/sqlite`.
   *
   * @public
   */
  export const layer = Layer.effect(RuntimeStorage, makeInMemoryRuntimeStorage);
}

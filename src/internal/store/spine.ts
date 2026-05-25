/**
 * Internal spine and projection helpers for process-store facets.
 *
 * @module processStoreSpine
 * @internal
 */

import {
  DateTime,
  Effect,
} from "effect";
import {
  decodeEventRow,
  encodeEvent,
  ProcessStoreEventDecodeError,
} from "./codec";
import type { EffectPmEventRow, JsonValue } from "../../ProcessStoreEvent";
import {
  type AnalyticsEvent,
  type ProcessExecutionCompletedEvent,
  type ProcessLifecycleChangedEvent,
  type ProcessStoreWriteError,
  type QueryOpts,
  type StoreEventQuery,
} from "../../ProcessStoreEvent";
import type {
  RunResourceFact,
  RunResourceFactQuery,
  RunResourceStateChange,
} from "../../store/runResource";
import {
  isJsonValue,
  isRecord,
  isString,
} from "../json";
import { processStoreWriteErrorFromRuntimeStorage } from "./helpers";
import type {
  DeleteResult,
  RuntimeRecord,
  RuntimeStorageService,
  UpdateResult,
} from "../../RuntimeStorage";
import type {
  RuntimeRecordPatch,
  RuntimeRecordQuery,
} from "../../Query";

/** @internal */
export const applyQueryOpts = <T>(
  rows: readonly T[],
  opts: QueryOpts | undefined,
  getTimestamp: (row: T) => number,
): T[] => {
  const filtered = rows.filter((row) => {
    const timestamp = getTimestamp(row);
    if (opts?.before !== undefined && timestamp >= opts.before) {
      return false;
    }
    if (opts?.after !== undefined && timestamp <= opts.after) {
      return false;
    }
    return true;
  });

  if (opts?.limit === undefined) {
    return filtered;
  }

  return filtered.slice(0, Math.max(0, opts.limit));
};

/**
 * Sort comparator: timestamp descending with deterministic tiebreaker.
 *
 * When two rows share an `occurredAt` (common at millisecond resolution) the
 * `getId` projection produces a stable secondary key so the surface order
 * matches across runs and across adapters (memory + sqlite). Without a
 * tiebreaker, `Array.prototype.sort` is stable only within a single sort
 * call — two ties from the spine vs an adapter could swap order, which
 * surfaced as flaky `.toEqual([...])` tests on dense-emit gates.
 *
 * @internal
 */
export const byTimestampDesc = <T>(
  getTimestamp: (row: T) => number,
  getId?: (row: T) => string,
) => (a: T, b: T) => {
  const byTime = getTimestamp(b) - getTimestamp(a);
  if (byTime !== 0) return byTime;
  if (getId === undefined) return 0;
  return getId(b).localeCompare(getId(a));
};

/** @internal */
export const matchesStoreEventQuery =
  (query: StoreEventQuery | undefined) =>
  (event: AnalyticsEvent): boolean => {
    if (query?.entityType !== undefined && event.entityType !== query.entityType) {
      return false;
    }
    if (query?.entityId !== undefined && event.entityId !== query.entityId) {
      return false;
    }
    if (
      query?.types !== undefined &&
      query.types.length > 0 &&
      !query.types.includes(event.type)
    ) {
      return false;
    }
    return true;
  };

/** @internal */
export const isProcessExecutionCompleted = (
  event: AnalyticsEvent,
): event is ProcessExecutionCompletedEvent =>
  event.type === "process.execution.completed" &&
  event.entityType === "process";

/** @internal Store query for process execution events — shared by monolith reads and future facet. */
export const processExecutionStoreQuery = (
  processId: string,
  opts?: QueryOpts,
): StoreEventQuery => ({
  entityType: "process",
  entityId: processId,
  types: ["process.execution.completed"],
  opts,
});

/** @internal Project execution rows from an in-memory event batch. */
export const processExecutionsFromEvents = (
  events: ReadonlyArray<AnalyticsEvent>,
  processId: string,
  opts?: QueryOpts,
): ProcessExecutionCompletedEvent[] =>
  selectEvents(
    events,
    processExecutionStoreQuery(processId, opts),
    isProcessExecutionCompleted,
  );

/** @internal */
export const isProcessLifecycleChanged = (
  event: AnalyticsEvent,
): event is ProcessLifecycleChangedEvent =>
  event.type === "process.lifecycle.changed" &&
  event.entityType === "process";

/** @internal Store query for process lifecycle events — shared by monolith reads and {@link ProcessStoreProcessLifecycle}. */
export const processLifecycleStoreQuery = (
  processId: string,
  opts?: QueryOpts,
): StoreEventQuery => ({
  entityType: "process",
  entityId: processId,
  types: ["process.lifecycle.changed"],
  opts,
});

/** @internal Project lifecycle rows from an in-memory event batch. */
export const processLifecycleFromEvents = (
  events: ReadonlyArray<AnalyticsEvent>,
  processId: string,
  opts?: QueryOpts,
): ProcessLifecycleChangedEvent[] =>
  selectEvents(
    events,
    processLifecycleStoreQuery(processId, opts),
    isProcessLifecycleChanged,
  );

// ============================================================================
// RunResource per-domain helpers (run-resource.fact.recorded /
// run-resource.state.changed wire event types)
// ============================================================================

const matchesRunResourceFactQuery =
  (query: RunResourceFactQuery | undefined) =>
  (fact: RunResourceFact): boolean => {
    if (query?.resourceId !== undefined && fact.resourceId !== query.resourceId) {
      return false;
    }
    if (query?.runId !== undefined && fact.runId !== query.runId) {
      return false;
    }
    if (
      query?.types !== undefined &&
      query.types.length > 0 &&
      !query.types.includes(fact.type)
    ) {
      return false;
    }
    return true;
  };

/** @internal */
export const runResourceFactStoreQuery = (
  query: RunResourceFactQuery | undefined,
): StoreEventQuery => ({
  entityType: "run-resource",
  entityId: query?.resourceId,
  types: ["run-resource.fact.recorded"],
  opts: query?.opts === undefined
    ? undefined
    : { before: query.opts.before, after: query.opts.after },
});

/** @internal */
export const runResourceFactsFromEvents = (
  events: ReadonlyArray<AnalyticsEvent>,
  query: RunResourceFactQuery | undefined,
): RunResourceFact[] => {
  const out: RunResourceFact[] = [];
  for (const event of events) {
    if (
      event.type === "run-resource.fact.recorded" &&
      matchesRunResourceFactQuery(query)(event.fact)
    ) {
      out.push(event.fact);
    }
  }
  return applyQueryOpts(out, query?.opts, (fact) => fact.occurredAt);
};

/** @internal */
export const runResourceStateChangedEventQuery = (
  resourceId: string | undefined,
): StoreEventQuery => ({
  entityType: "run-resource",
  entityId: resourceId,
  types: ["run-resource.state.changed"],
});

/** @internal */
export const runResourceStateChangesFromEvents = (
  events: ReadonlyArray<AnalyticsEvent>,
  resourceId?: string,
): RunResourceStateChange[] => {
  const out: RunResourceStateChange[] = [];
  for (const event of events) {
    if (event.type !== "run-resource.state.changed") continue;
    if (resourceId !== undefined && event.change.resourceId !== resourceId) {
      continue;
    }
    out.push(event.change);
  }
  return out;
};

/** @internal */
export const selectEvents = <T extends AnalyticsEvent>(
  events: ReadonlyArray<AnalyticsEvent>,
  query: StoreEventQuery,
  refine: (event: AnalyticsEvent) => event is T,
): T[] => {
  const rows = events
    .filter(matchesStoreEventQuery(query))
    .filter(refine)
    .sort((a, b) => {
      const byTime = b.occurredAt - a.occurredAt;
      if (byTime !== 0) {
        return byTime;
      }
      return b.id.localeCompare(a.id);
    });
  return applyQueryOpts(rows, query.opts, (event) => event.occurredAt);
};

const stringAttribute = (
  attributes: Record<string, unknown> | undefined,
  key: string,
): string | undefined => {
  const value = attributes?.[key];
  return isString(value) ? value : undefined;
};

const stringArrayAttribute = (
  attributes: Record<string, unknown> | undefined,
  key: string,
): ReadonlyArray<string> | undefined => {
  const value = attributes?.[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  const out: string[] = [];
  for (const item of value) {
    if (!isString(item)) {
      return undefined;
    }
    out.push(item);
  }
  return out;
};

const runtimeRecordPayload = (event: AnalyticsEvent): JsonValue | undefined => {
  const payload = encodeEvent(event).payload;
  return isJsonValue(payload) ? payload : undefined;
};

const runtimeRecordAttributes = (event: AnalyticsEvent): JsonValue | undefined => {
  const out: { [key: string]: JsonValue } = {};
  let hasAttributes = false;
  if (
    event.attributes !== undefined &&
    isJsonValue(event.attributes) &&
    isRecord(event.attributes)
  ) {
    for (const [key, value] of Object.entries(event.attributes)) {
      if (isJsonValue(value)) {
        out[key] = value;
        hasAttributes = true;
      }
    }
  }
  return hasAttributes ? out : undefined;
};

const isKnownEventRecordType = (
  type: string,
): type is AnalyticsEvent["type"] => {
  switch (type) {
    case "process.execution.completed":
    case "process.lifecycle.changed":
    case "queue.entry.enqueued":
    case "queue.entry.started":
    case "queue.entry.completed":
    case "queue.entry.failed":
    case "queue.entry.retried":
    case "queue.entry.exhausted":
    case "queue.entry.released":
    case "queue.entry.dead-lettered":
    case "queue.entry.dropped":
    case "queue.lifecycle.started":
    case "queue.lifecycle.paused":
    case "queue.lifecycle.resumed":
    case "queue.lifecycle.shutdown":
    case "queue.lifecycle.cleared":
    case "queue.lifecycle.drained":
    case "queue.dedupe-key.added":
    case "queue.dedupe-key.released":
    case "queue.dedupe-key.hydrated":
    case "run-resource.fact.recorded":
    case "run-resource.state.changed":
    case "log.entry":
      return true;
    default:
      return false;
  }
};

const recordToStoredEventRow = (record: RuntimeRecord): EffectPmEventRow | null => {
  if (!isKnownEventRecordType(record.type)) {
    return null;
  }
  const payload = record.payload;
  if (payload === undefined) {
    return null;
  }
  if (!isJsonValue(payload)) {
    return null;
  }
  return {
    id: record.id,
    type: record.type,
    occurredAt: DateTime.toDateUtc(record.occurredAt),
    entityType: record.processType,
    entityId: record.processId,
    attributes: record.attributes ?? null,
    payload,
    createdAt: DateTime.toDateUtc(record.createdAt),
  };
};

const decodeStoredEvent = (row: EffectPmEventRow): AnalyticsEvent | null => {
  const decoded = decodeEventRow(row);
  return decoded instanceof ProcessStoreEventDecodeError ? null : decoded;
};

const recordToAnalyticsEvent = (record: RuntimeRecord): AnalyticsEvent | null => {
  const row = recordToStoredEventRow(record);
  if (row === null) {
    return null;
  }
  return decodeStoredEvent(row);
};

/** @internal */
export const recordsToEvents = (
  records: ReadonlyArray<RuntimeRecord>,
): AnalyticsEvent[] => {
  const out: AnalyticsEvent[] = [];
  for (const record of records) {
    const event = recordToAnalyticsEvent(record);
    if (event !== null) {
      out.push(event);
    }
  }
  return out;
};

/** @internal */
export const eventToRuntimeRecord = (
  event: AnalyticsEvent,
  runId: string,
): RuntimeRecord => {
  const attributes = event.attributes;
  const recordAttrs = runtimeRecordAttributes(event);
  const occurredAt = DateTime.makeUnsafe(event.occurredAt);
  return {
    id: event.id,
    type: event.type,
    occurredAt,
    createdAt: occurredAt,
    runId,
    processType: stringAttribute(attributes, "processType") ?? event.entityType,
    processId: stringAttribute(attributes, "processId") ?? event.entityId,
    subjectType: stringAttribute(attributes, "subjectType"),
    subjectId: stringAttribute(attributes, "subjectId"),
    key: stringAttribute(attributes, "key"),
    indexA: stringAttribute(attributes, "indexA"),
    indexB: stringAttribute(attributes, "indexB"),
    indexC: stringAttribute(attributes, "indexC"),
    indexD: stringAttribute(attributes, "indexD"),
    indexE: stringAttribute(attributes, "indexE"),
    indexF: stringAttribute(attributes, "indexF"),
    indexG: stringAttribute(attributes, "indexG"),
    indexH: stringAttribute(attributes, "indexH"),
    indexNames: stringArrayAttribute(attributes, "indexNames"),
    payload: runtimeRecordPayload(event),
    attributes: recordAttrs,
  };
};

/**
 * Per-facet handle into the underlying {@link RuntimeStorage}.
 *
 * @remarks
 * The shape exposes both the new `RuntimeRecord`-direct API
 * (`runId`, `create`, `createBatch`, `read`, `upsert`, `update`, `delete`)
 * that all facets are migrating to, and the legacy `AnalyticsEvent`-flavored
 * shims (`append`, `appendBatch`, `events`, `records`) used by facets that
 * have not yet been migrated. The legacy methods are removed at the end
 * of the migration.
 *
 * @internal
 */
export interface ProcessStoreSpine {
  readonly runId: string;
  readonly create: (
    record: Omit<RuntimeRecord, "runId" | "createdAt">,
  ) => Effect.Effect<void, ProcessStoreWriteError>;
  readonly createBatch: (
    records: ReadonlyArray<Omit<RuntimeRecord, "runId" | "createdAt">>,
  ) => Effect.Effect<void, ProcessStoreWriteError>;
  readonly read: (
    query?: RuntimeRecordQuery,
  ) => Effect.Effect<RuntimeRecord[]>;
  readonly upsert: (
    record: Omit<RuntimeRecord, "runId" | "createdAt">,
  ) => Effect.Effect<void, ProcessStoreWriteError>;
  readonly update: (
    query: RuntimeRecordQuery,
    patch: RuntimeRecordPatch,
  ) => Effect.Effect<UpdateResult>;
  readonly delete: (query: RuntimeRecordQuery) => Effect.Effect<DeleteResult>;
  readonly append: (
    event: AnalyticsEvent,
  ) => Effect.Effect<void, ProcessStoreWriteError>;
  readonly appendBatch: (
    events: ReadonlyArray<AnalyticsEvent>,
  ) => Effect.Effect<void, ProcessStoreWriteError>;
  readonly events: (
    query?: StoreEventQuery,
  ) => Effect.Effect<AnalyticsEvent[]>;
  readonly records: (
    query?: RuntimeRecordQuery,
  ) => Effect.Effect<RuntimeRecord[]>;
}

/** @internal */
export const makeProcessStoreSpine = (
  storage: RuntimeStorageService,
  runId: string,
): ProcessStoreSpine => {
  const stamp = (
    record: Omit<RuntimeRecord, "runId" | "createdAt">,
  ): RuntimeRecord => ({ ...record, runId, createdAt: record.occurredAt });
  const create = (record: Omit<RuntimeRecord, "runId" | "createdAt">) =>
    storage
      .create(stamp(record))
      .pipe(Effect.mapError(processStoreWriteErrorFromRuntimeStorage));
  const createBatch = (
    records: ReadonlyArray<Omit<RuntimeRecord, "runId" | "createdAt">>,
  ) => Effect.forEach(records, create, { discard: true });
  const upsert = (record: Omit<RuntimeRecord, "runId" | "createdAt">) =>
    storage
      .upsert(stamp(record))
      .pipe(Effect.mapError(processStoreWriteErrorFromRuntimeStorage));
  const read = (query: RuntimeRecordQuery | undefined) => storage.read(query);
  const update = (query: RuntimeRecordQuery, patch: RuntimeRecordPatch) =>
    storage.update(query, patch);
  const remove = (query: RuntimeRecordQuery) => storage.delete(query);

  const appendEvent = (event: AnalyticsEvent) =>
    storage
      .create(eventToRuntimeRecord(event, runId))
      .pipe(Effect.mapError(processStoreWriteErrorFromRuntimeStorage));
  const readEvents = (query: StoreEventQuery | undefined) =>
    Effect.map(storage.read(), (records) => {
      const rows = recordsToEvents(records)
        .filter(matchesStoreEventQuery(query))
        .sort(
          byTimestampDesc(
            (event) => event.occurredAt,
            (event) => event.id,
          ),
        );
      return applyQueryOpts(rows, query?.opts, (event) => event.occurredAt);
    });

  return {
    runId,
    create,
    createBatch,
    read,
    upsert,
    update,
    delete: remove,
    append: appendEvent,
    appendBatch: (batch) =>
      Effect.forEach(batch, appendEvent, { discard: true }),
    events: readEvents,
    records: read,
  };
};


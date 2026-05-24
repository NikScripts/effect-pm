/**
 * Internal spine and projection helpers for {@link ProcessStoreInterface}.
 *
 * @module processStoreSpine
 * @internal
 */

import {
  Clock,
  DateTime,
  Effect,
  FileSystem,
  Option,
  Path,
  Schema,
  Semaphore,
} from "effect";
import {
  decodeEventRow,
  encodeEvent,
  ProcessStoreEventDecodeError,
} from "./codec";
import type { EffectPmEventRow, JsonValue } from "../../ProcessStoreEvent";
import type { ProcessStoreGroupLogApi } from "./groupLog";
import type { ProcessStoreQueueResourceApi } from "./queueResource";
import {
  ProcessStoreDuplicateRecordError,
  ProcessStoreReadonlyRecordError,
  type AnalyticsEvent,
  type ProcessExecutionCompletedEvent,
  type ProcessLifecycleChangedEvent,
  type ProcessStoreWriteError,
  type QueryOpts,
  type QueueItemCompletedEvent,
  type QueueLifecycleChangedEvent,
  type RuntimeFactQuery,
  type RuntimeStateHistoryQuery,
  type StoreEventQuery,
} from "../../ProcessStoreEvent";
import type { ProcessStoreInterface } from "../../ProcessStore";
import type { RuntimeFact, RuntimeStateChange } from "../../RuntimeState";
import {
  dateFromUnknown,
  isJsonValue,
  isRecord,
  isString,
  unknownJsonString,
} from "../json";
import type { RuntimeRecordQuery } from "../../Query";
import {
  RuntimeStorageDuplicateRecordError,
  RuntimeStorageReadonlyRecordError,
  selectRuntimeRecords,
  type RuntimeRecord,
  type RuntimeStorageError,
  type RuntimeStorageService,
} from "../../RuntimeStorage";

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

/** @internal */
export const byTimestampDesc = <T>(getTimestamp: (row: T) => number) => (a: T, b: T) =>
  getTimestamp(b) - getTimestamp(a);

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

/** @internal */
export const isQueueItemCompleted = (
  event: AnalyticsEvent,
): event is QueueItemCompletedEvent =>
  event.type === "queue.item.completed" && event.entityType === "queue";

/** @internal */
export const isQueueLifecycleChanged = (
  event: AnalyticsEvent,
): event is QueueLifecycleChangedEvent =>
  event.type === "queue.lifecycle.changed" && event.entityType === "queue";

const matchesRuntimeFactQuery =
  (query: RuntimeFactQuery | undefined) =>
  (fact: RuntimeFact): boolean => {
    if (query?.ref !== undefined) {
      if (fact.ref.kind !== query.ref.kind || fact.ref.id !== query.ref.id) {
        return false;
      }
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
export const runtimeFactStoreQuery = (
  query: RuntimeFactQuery | undefined,
): StoreEventQuery => ({
  entityType: query?.ref?.kind,
  entityId: query?.ref?.id,
  types: ["runtime.fact.recorded"],
  opts: query?.opts === undefined
    ? undefined
    : {
        before: query.opts.before,
        after: query.opts.after,
      },
});

/** @internal */
export const runtimeFactsFromEvents = (
  events: ReadonlyArray<AnalyticsEvent>,
  query: RuntimeFactQuery | undefined,
): RuntimeFact[] => {
  const out: RuntimeFact[] = [];
  for (const event of events) {
    if (
      event.type === "runtime.fact.recorded" &&
      matchesRuntimeFactQuery(query)(event.fact)
    ) {
      out.push(event.fact);
    }
  }
  return applyQueryOpts(out, query?.opts, (fact) => fact.occurredAt);
};

/** @internal */
export const runtimeStateStoreQuery = (
  query: RuntimeStateHistoryQuery,
): StoreEventQuery => ({
  entityType: query.ref.kind,
  entityId: query.ref.id,
  types: ["runtime.state.changed"],
  opts: query.opts,
});

/** @internal */
export const runtimeStateChangesFromEvents = (
  events: ReadonlyArray<AnalyticsEvent>,
): RuntimeStateChange[] => {
  const out: RuntimeStateChange[] = [];
  for (const event of events) {
    if (event.type === "runtime.state.changed") {
      out.push(event.change);
    }
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
    .sort(byTimestampDesc((event) => event.occurredAt));
  return applyQueryOpts(rows, query.opts, (event) => event.occurredAt);
};

let inMemoryProcessStoreRunCounter = 0;

/** @internal */
export const makeRunId = (now: number): string => {
  inMemoryProcessStoreRunCounter++;
  return `run-${String(now)}-${String(inMemoryProcessStoreRunCounter)}`;
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
  if (event.type === "runtime.fact.recorded") {
    return isJsonValue(event.fact.payload) ? event.fact.payload : undefined;
  }
  const payload = encodeEvent(event).payload;
  return isJsonValue(payload) ? payload : undefined;
};

const runtimeRecordType = (event: AnalyticsEvent): string =>
  event.type === "runtime.fact.recorded" ? event.fact.type : event.type;

const runtimeRecordOccurredAt = (event: AnalyticsEvent): number =>
  event.type === "runtime.fact.recorded" ? event.fact.occurredAt : event.occurredAt;

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
  if (event.type === "runtime.fact.recorded") {
    out["factId"] = event.fact.id;
    hasAttributes = true;
  }
  return hasAttributes ? out : undefined;
};

const isLegacyEventRecordType = (type: string): type is Exclude<
  AnalyticsEvent["type"],
  "runtime.fact.recorded"
> => {
  switch (type) {
    case "process.execution.completed":
    case "process.lifecycle.changed":
    case "queue.item.completed":
    case "queue.lifecycle.changed":
    case "runtime.state.changed":
    case "group.log.entry":
      return true;
    default:
      return false;
  }
};

const recordAttributes = (
  value: JsonValue | undefined,
): Record<string, unknown> | undefined => {
  if (value === undefined || !isRecord(value)) {
    return undefined;
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = item;
  }
  return out;
};

const recordToStoredEventRow = (record: RuntimeRecord): EffectPmEventRow | null => {
  if (!isLegacyEventRecordType(record.type)) {
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
  if (row !== null) {
    return decodeStoredEvent(row);
  }
  const occurredAt = DateTime.toEpochMillis(record.occurredAt);
  const attributes = recordAttributes(record.attributes);
  const factId = stringAttribute(attributes, "factId") ?? record.id;
  return {
    id: record.id,
    type: "runtime.fact.recorded",
    occurredAt,
    entityType: record.processType,
    entityId: record.processId,
    attributes,
    fact: {
      id: factId,
      ref: { kind: record.processType, id: record.processId },
      type: record.type,
      occurredAt,
      payload: record.payload ?? null,
      attributes,
    },
  };
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
export const processStoreWriteErrorFromRuntimeStorage = (
  error: RuntimeStorageError,
): ProcessStoreWriteError => {
  if (error instanceof RuntimeStorageDuplicateRecordError) {
    return new ProcessStoreDuplicateRecordError({ id: error.id });
  }
  if (error instanceof RuntimeStorageReadonlyRecordError) {
    return new ProcessStoreReadonlyRecordError({ id: error.id });
  }
  return error;
};

/** @internal */
export const eventToRuntimeRecord = (
  event: AnalyticsEvent,
  runId: string,
): RuntimeRecord => {
  const attributes = event.attributes;
  const recordAttrs = runtimeRecordAttributes(event);
  const occurredAt = DateTime.makeUnsafe(runtimeRecordOccurredAt(event));
  return {
    id: event.id,
    type: runtimeRecordType(event),
    occurredAt,
    createdAt: DateTime.makeUnsafe(event.occurredAt),
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

export interface ProcessStoreSpine {
  readonly append: (event: AnalyticsEvent) => Effect.Effect<void, ProcessStoreWriteError>;
  readonly appendBatch: (events: ReadonlyArray<AnalyticsEvent>) => Effect.Effect<void, ProcessStoreWriteError>;
  readonly events: (query?: StoreEventQuery) => Effect.Effect<AnalyticsEvent[]>;
  readonly records: (query?: RuntimeRecordQuery) => Effect.Effect<RuntimeRecord[]>;
}

/** @internal */
export const makeProcessStoreSpine = (
  storage: RuntimeStorageService,
  runId: string,
): ProcessStoreSpine => {
  const appendEvent = (event: AnalyticsEvent) =>
    storage.create(eventToRuntimeRecord(event, runId)).pipe(
      Effect.mapError(processStoreWriteErrorFromRuntimeStorage),
    );
  const readRecords = (query: RuntimeRecordQuery | undefined) =>
    storage.read(query);
  const readEvents = (query: StoreEventQuery | undefined) =>
    Effect.map(storage.read(), (records) => {
      const rows = recordsToEvents(records)
        .filter(matchesStoreEventQuery(query))
        .sort(byTimestampDesc((event) => event.occurredAt));
      return applyQueryOpts(rows, query?.opts, (event) => event.occurredAt);
    });

  return {
    append: appendEvent,
    appendBatch: (batch) =>
      Effect.forEach(batch, appendEvent, { discard: true }),
    events: readEvents,
    records: readRecords,
  };
};

/** @internal */
export const assembleProcessStoreInterface = (
  spine: ProcessStoreSpine,
  groupLog: ProcessStoreGroupLogApi,
  queue: ProcessStoreQueueResourceApi,
): ProcessStoreInterface => ({
  append: spine.append,
  appendBatch: spine.appendBatch,
  events: spine.events,
  records: spine.records,
  GroupLog: groupLog,
  QueueResource: queue,
  getProcessExecutions: (processId, opts) =>
    Effect.map(
      spine.events(processExecutionStoreQuery(processId, opts)),
      (events) => processExecutionsFromEvents(events, processId, opts),
    ),
  getProcessLifecycle: (processId, opts) =>
    Effect.map(spine.events({
      entityType: "process",
      entityId: processId,
      types: ["process.lifecycle.changed"],
      opts,
    }), (events) =>
      selectEvents(
        events,
        { entityType: "process", entityId: processId, types: ["process.lifecycle.changed"], opts },
        isProcessLifecycleChanged,
      ),
    ),
  getQueueItemCompletions: (queueId, opts) =>
    Effect.map(spine.events({
      entityType: "queue",
      entityId: queueId,
      types: ["queue.item.completed"],
      opts,
    }), (events) =>
      selectEvents(
        events,
        { entityType: "queue", entityId: queueId, types: ["queue.item.completed"], opts },
        isQueueItemCompleted,
      ),
    ),
  getQueueLifecycle: (queueId, opts) =>
    Effect.map(spine.events({
      entityType: "queue",
      entityId: queueId,
      types: ["queue.lifecycle.changed"],
      opts,
    }), (events) =>
      selectEvents(
        events,
        { entityType: "queue", entityId: queueId, types: ["queue.lifecycle.changed"], opts },
        isQueueLifecycleChanged,
      ),
    ),
});

const encodeJsonLine = (value: unknown): string | null =>
  Option.match(Schema.encodeUnknownOption(unknownJsonString)(value), {
    onNone: () => null,
    onSome: (line) => line,
  });

const decodeJsonLine = (line: string): unknown | null =>
  Option.match(Schema.decodeUnknownOption(unknownJsonString)(line), {
    onNone: () => null,
    onSome: (value) => value,
  });

const decodeFileRow = (value: unknown): EffectPmEventRow | null => {
  if (!isRecord(value)) {
    return null;
  }

  const id = value["id"];
  const type = value["type"];
  const occurredAt = dateFromUnknown(value["occurredAt"]);
  const entityType = value["entityType"];
  const entityId = value["entityId"];
  const attributes = value["attributes"];
  const payload = value["payload"];
  const createdAt = dateFromUnknown(value["createdAt"]) ?? occurredAt;

  if (
    !isString(id) ||
    !isString(type) ||
    occurredAt === null ||
    !isString(entityType) ||
    !isString(entityId) ||
    !isJsonValue(payload) ||
    !(attributes === undefined || attributes === null || isJsonValue(attributes)) ||
    createdAt === null
  ) {
    return null;
  }

  return {
    id,
    type,
    occurredAt,
    entityType,
    entityId,
    attributes: attributes === undefined ? null : attributes,
    payload,
    createdAt,
  };
};

const decodeFileContents = (contents: string): AnalyticsEvent[] => {
  const out: AnalyticsEvent[] = [];
  for (const line of contents.split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }
    const value = decodeJsonLine(line);
    const row = value === null ? null : decodeFileRow(value);
    if (row === null) {
      continue;
    }
    const event = decodeStoredEvent(row);
    if (event !== null) {
      out.push(event);
    }
  }
  return out;
};

const encodeFileEventLine = (
  event: AnalyticsEvent,
  createdAt: number,
): string | null => {
  const encoded = encodeEvent(event);
  const row: { [key: string]: JsonValue } = {
    id: encoded.id,
    type: encoded.type,
    occurredAt: event.occurredAt,
    entityType: encoded.entityType,
    entityId: encoded.entityId,
    attributes: encoded.attributes ?? null,
    payload: encoded.payload,
    createdAt,
  };
  const line = encodeJsonLine(row);
  return line === null ? null : `${line}\n`;
};

/** @internal */
export const makeFileProcessStoreSpine = (
  filePath: string,
): Effect.Effect<
  ProcessStoreSpine,
  never,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const semaphore = yield* Semaphore.make(1);
    const directory = path.dirname(filePath);
    const ensureDirectory = fs
      .makeDirectory(directory, { recursive: true })
      .pipe(Effect.orDie);

    const readEvents = Effect.gen(function* () {
      yield* ensureDirectory;
      const exists = yield* fs.exists(filePath).pipe(Effect.orDie);
      if (!exists) {
        return [];
      }
      const contents = yield* fs.readFileString(filePath).pipe(Effect.orDie);
      return decodeFileContents(contents);
    });

    const appendOne = (event: AnalyticsEvent) =>
      Effect.gen(function* () {
        yield* ensureDirectory;
        const now = yield* Clock.currentTimeMillis;
        const line = encodeFileEventLine(event, now);
        if (line !== null) {
          yield* fs.writeFileString(filePath, line, { flag: "a" }).pipe(Effect.orDie);
        }
      });

    const queryEvents = (query: StoreEventQuery | undefined) =>
      Effect.map(readEvents, (storedEvents) => {
        const rows = storedEvents
          .filter(matchesStoreEventQuery(query))
          .sort(byTimestampDesc((event) => event.occurredAt));
        return applyQueryOpts(rows, query?.opts, (event) => event.occurredAt);
      });

    const queryRecords = (query: RuntimeRecordQuery | undefined) =>
      Effect.map(readEvents, (storedEvents) =>
        selectRuntimeRecords(
          storedEvents.map((event) => eventToRuntimeRecord(event, "file-store")),
          query,
        )
      );
    const appendSerializedEvent = (event: AnalyticsEvent) =>
      semaphore.withPermits(1)(appendOne(event));

    return {
      append: appendSerializedEvent,
      appendBatch: (batch) =>
        semaphore.withPermits(1)(
          Effect.gen(function* () {
            for (const event of batch) {
              yield* appendOne(event);
            }
          }),
        ),
      events: (query) => semaphore.withPermits(1)(queryEvents(query)),
      records: (query) => semaphore.withPermits(1)(queryRecords(query)),
    };
  });

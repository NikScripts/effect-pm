/**
 * Encode/decode boundary between typed ProcessStore events and stored rows.
 *
 * @module ProcessStore/Codec
 */

import { Data } from "effect";
import type {
  AnalyticsEvent,
  ProcessExecutionCompletedEvent,
  ProcessLifecycleChangedEvent,
  ProcessLifecycleTag,
  QueueItemCompletedEvent,
  QueueItemStatus,
  QueueLifecycleChangedEvent,
  QueueLifecycleTag,
  RuntimeFactRecordedEvent,
} from "./ProcessStore";
import type {
  EffectPmEventCreateInput,
  EffectPmEventRow,
  JsonValue,
} from "./ProcessStoreEvent";
import type { RuntimeFact, RuntimeRef } from "./RuntimeState";
import {
  dateFromMillis,
  epochMillisFromUnknown,
  isBoolean,
  isFiniteNumber,
  isRecord,
  isString,
} from "./internal/json";

/**
 * Raised when a persisted event row does not conform to a known
 * {@link AnalyticsEvent} shape.
 *
 * @public
 */
export class ProcessStoreEventDecodeError extends Data.TaggedError(
  "ProcessStoreEventDecodeError",
)<{
  readonly rowId: string;
  readonly reason: string;
}> {}

const includesString = <T extends string>(
  values: ReadonlyArray<T>,
  value: string,
): value is T => values.some((item) => item === value);

const lifecycleTags: ReadonlyArray<ProcessLifecycleTag> = [
  "Started",
  "Stopped",
  "Restarted",
  "Errored",
  "Recovered",
  "Disabled",
  "Enabled",
];

const isLifecycleTag = (value: unknown): value is ProcessLifecycleTag =>
  isString(value) &&
  includesString(lifecycleTags, value);

const executionStatuses: ReadonlyArray<
  ProcessExecutionCompletedEvent["execution"]["status"]
> = ["completed", "failed", "interrupted"];

const isExecutionStatus = (
  value: unknown,
): value is ProcessExecutionCompletedEvent["execution"]["status"] =>
  isString(value) && includesString(executionStatuses, value);

const queueItemStatuses: ReadonlyArray<QueueItemStatus> = [
  "completed",
  "failed",
  "retried",
  "exhausted",
];

const isQueueItemStatus = (value: unknown): value is QueueItemStatus =>
  isString(value) &&
  includesString(queueItemStatuses, value);

const queuePriorities: ReadonlyArray<QueueItemCompletedEvent["item"]["priority"]> = [
  "high",
  "normal",
  "low",
];

const isQueuePriority = (
  value: unknown,
): value is QueueItemCompletedEvent["item"]["priority"] =>
  isString(value) && includesString(queuePriorities, value);

const queueLifecycleTags: ReadonlyArray<QueueLifecycleTag> = [
  "Started",
  "Paused",
  "Resumed",
  "Shutdown",
  "Cleared",
];

const isQueueLifecycleTag = (value: unknown): value is QueueLifecycleTag =>
  isString(value) &&
  includesString(queueLifecycleTags, value);

/**
 * Convert an {@link AnalyticsEvent} into a storage create input.
 *
 * @public
 */
export const encodeEvent = (event: AnalyticsEvent): EffectPmEventCreateInput => {
  const attributes = encodeAttributes(event.attributes);
  switch (event.type) {
    case "process.execution.completed":
      return {
        id: event.id,
        type: event.type,
        occurredAt: dateFromMillis(event.occurredAt),
        entityType: event.entityType,
        entityId: event.entityId,
        attributes,
        payload: encodeExecutionPayload(event),
      };
    case "process.lifecycle.changed":
      return {
        id: event.id,
        type: event.type,
        occurredAt: dateFromMillis(event.occurredAt),
        entityType: event.entityType,
        entityId: event.entityId,
        attributes,
        payload: encodeLifecyclePayload(event),
      };
    case "queue.item.completed":
      return {
        id: event.id,
        type: event.type,
        occurredAt: dateFromMillis(event.occurredAt),
        entityType: event.entityType,
        entityId: event.entityId,
        attributes,
        payload: encodeQueueItemPayload(event),
      };
    case "queue.lifecycle.changed":
      return {
        id: event.id,
        type: event.type,
        occurredAt: dateFromMillis(event.occurredAt),
        entityType: event.entityType,
        entityId: event.entityId,
        attributes,
        payload: encodeQueueLifecyclePayload(event),
      };
    case "runtime.fact.recorded":
      return {
        id: event.id,
        type: event.type,
        occurredAt: dateFromMillis(event.occurredAt),
        entityType: event.entityType,
        entityId: event.entityId,
        attributes,
        payload: encodeRuntimeFactPayload(event),
      };
  }
};

const encodeAttributes = (
  attributes: Record<string, unknown> | undefined,
): JsonValue | null => {
  if (attributes === undefined) {
    return null;
  }
  return toJsonValue(attributes);
};

const encodeExecutionPayload = (
  event: ProcessExecutionCompletedEvent,
): JsonValue => {
  const { execution } = event;
  const payload: { [key: string]: JsonValue } = {
    scheduleKey: execution.scheduleKey,
    startedAt: execution.startedAt,
    completedAt: execution.completedAt,
    durationMs: execution.durationMs,
    status: execution.status,
    isStartupRun: execution.isStartupRun,
  };
  if (execution.error !== undefined) {
    payload["error"] = execution.error;
  }
  return payload;
};

const encodeLifecyclePayload = (
  event: ProcessLifecycleChangedEvent,
): JsonValue => {
  const payload: { [key: string]: JsonValue } = {
    tag: event.lifecycle.tag,
  };
  if (event.lifecycle.error !== undefined) {
    payload["error"] = event.lifecycle.error;
  }
  return payload;
};

const encodeQueueItemPayload = (
  event: QueueItemCompletedEvent,
): JsonValue => {
  const payload: { [key: string]: JsonValue } = {
    status: event.item.status,
    priority: event.item.priority,
    durationMs: event.item.durationMs,
    attempts: event.item.attempts,
  };
  if (event.item.error !== undefined) {
    payload["error"] = event.item.error;
  }
  return payload;
};

const encodeQueueLifecyclePayload = (
  event: QueueLifecycleChangedEvent,
): JsonValue => {
  const payload: { [key: string]: JsonValue } = {
    tag: event.lifecycle.tag,
  };
  if (event.lifecycle.itemsCleared !== undefined) {
    payload["itemsCleared"] = event.lifecycle.itemsCleared;
  }
  return payload;
};

const encodeRuntimeFactPayload = (
  event: RuntimeFactRecordedEvent,
): JsonValue => ({
  fact: toJsonValue(event.fact),
});

const toJsonValue = (value: unknown): JsonValue => {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (isString(value) || isFiniteNumber(value) || isBoolean(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(toJsonValue);
  }
  if (isRecord(value)) {
    const out: { [key: string]: JsonValue } = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = toJsonValue(item);
    }
    return out;
  }
  return null;
};

/**
 * Decode a persisted row into a typed {@link AnalyticsEvent}.
 *
 * @public
 */
export const decodeEventRow = (
  row: EffectPmEventRow,
): AnalyticsEvent | ProcessStoreEventDecodeError => {
  switch (row.type) {
    case "process.execution.completed":
      return decodeExecution(row);
    case "process.lifecycle.changed":
      return decodeLifecycle(row);
    case "queue.item.completed":
      return decodeQueueItem(row);
    case "queue.lifecycle.changed":
      return decodeQueueLifecycle(row);
    case "runtime.fact.recorded":
      return decodeRuntimeFact(row);
    default:
      return new ProcessStoreEventDecodeError({
        rowId: row.id,
        reason: `unknown event type: ${row.type}`,
      });
  }
};

const decodeRuntimeRef = (
  value: unknown,
): RuntimeRef | null => {
  if (!isRecord(value)) {
    return null;
  }
  const kind = value["kind"];
  const id = value["id"];
  if (!isString(kind) || !isString(id)) {
    return null;
  }
  return { kind, id };
};

const decodeRuntimeFactValue = (
  value: unknown,
): RuntimeFact | null => {
  if (!isRecord(value)) {
    return null;
  }
  const id = value["id"];
  const ref = decodeRuntimeRef(value["ref"]);
  const type = value["type"];
  const occurredAt = value["occurredAt"];
  if (
    !isString(id) ||
    ref === null ||
    !isString(type) ||
    !isFiniteNumber(occurredAt)
  ) {
    return null;
  }
  const attributes = decodeAttributes(
    value["attributes"] === undefined ? null : toJsonValue(value["attributes"]),
  );
  return {
    id,
    ref,
    type,
    occurredAt,
    payload: value["payload"],
    ...(attributes === undefined ? {} : { attributes }),
  };
};

const decodeAttributes = (
  attributes: JsonValue | null,
): Record<string, unknown> | undefined => {
  if (attributes === null) return undefined;
  if (!isRecord(attributes)) return undefined;
  const out: { [key: string]: unknown } = {};
  for (const [key, value] of Object.entries(attributes)) {
    out[key] = value;
  }
  return out;
};

const decodeExecution = (
  row: EffectPmEventRow,
): ProcessExecutionCompletedEvent | ProcessStoreEventDecodeError => {
  if (row.entityType !== "process") {
    return new ProcessStoreEventDecodeError({
      rowId: row.id,
      reason: `entityType must be "process" for execution events, got ${row.entityType}`,
    });
  }
  const payload = row.payload;
  if (!isRecord(payload)) {
    return new ProcessStoreEventDecodeError({
      rowId: row.id,
      reason: "payload is not an object",
    });
  }
  const startedAt = epochMillisFromUnknown(payload["startedAt"]);
  const completedAt = epochMillisFromUnknown(payload["completedAt"]);
  const durationMs = payload["durationMs"];
  const status = payload["status"];
  const scheduleKey = payload["scheduleKey"];
  const isStartupRun = payload["isStartupRun"];
  const errorRaw = payload["error"];

  if (startedAt === null) {
    return failPayload(row, "startedAt");
  }
  if (completedAt === null) {
    return failPayload(row, "completedAt");
  }
  if (!isFiniteNumber(durationMs)) {
    return failPayload(row, "durationMs");
  }
  if (!isExecutionStatus(status)) {
    return failPayload(row, "status");
  }
  if (scheduleKey !== null && !isString(scheduleKey)) {
    return failPayload(row, "scheduleKey");
  }
  if (!isBoolean(isStartupRun)) {
    return failPayload(row, "isStartupRun");
  }
  const error =
    errorRaw === undefined
      ? undefined
      : isString(errorRaw)
        ? errorRaw
        : null;
  if (error === null) {
    return failPayload(row, "error");
  }

  const execution: ProcessExecutionCompletedEvent["execution"] = {
    scheduleKey,
    startedAt,
    completedAt,
    durationMs,
    status,
    isStartupRun,
    ...(error === undefined ? {} : { error }),
  };

  return {
    id: row.id,
    type: "process.execution.completed",
    occurredAt: row.occurredAt.getTime(),
    entityType: "process",
    entityId: row.entityId,
    attributes: decodeAttributes(row.attributes),
    execution,
  };
};

const decodeLifecycle = (
  row: EffectPmEventRow,
): ProcessLifecycleChangedEvent | ProcessStoreEventDecodeError => {
  if (row.entityType !== "process") {
    return new ProcessStoreEventDecodeError({
      rowId: row.id,
      reason: `entityType must be "process" for lifecycle events, got ${row.entityType}`,
    });
  }
  const payload = row.payload;
  if (!isRecord(payload)) {
    return new ProcessStoreEventDecodeError({
      rowId: row.id,
      reason: "payload is not an object",
    });
  }
  const tag = payload["tag"];
  const errorRaw = payload["error"];
  if (!isLifecycleTag(tag)) {
    return failPayload(row, "tag");
  }
  const error =
    errorRaw === undefined
      ? undefined
      : isString(errorRaw)
        ? errorRaw
        : null;
  if (error === null) {
    return failPayload(row, "error");
  }
  const lifecycle: ProcessLifecycleChangedEvent["lifecycle"] = {
    tag,
    ...(error === undefined ? {} : { error }),
  };
  return {
    id: row.id,
    type: "process.lifecycle.changed",
    occurredAt: row.occurredAt.getTime(),
    entityType: "process",
    entityId: row.entityId,
    attributes: decodeAttributes(row.attributes),
    lifecycle,
  };
};

const decodeQueueItem = (
  row: EffectPmEventRow,
): QueueItemCompletedEvent | ProcessStoreEventDecodeError => {
  if (row.entityType !== "queue") {
    return new ProcessStoreEventDecodeError({
      rowId: row.id,
      reason: `entityType must be "queue" for queue item events, got ${row.entityType}`,
    });
  }
  const payload = row.payload;
  if (!isRecord(payload)) {
    return new ProcessStoreEventDecodeError({
      rowId: row.id,
      reason: "payload is not an object",
    });
  }
  const status = payload["status"];
  const priority = payload["priority"];
  const durationMs = payload["durationMs"];
  const attempts = payload["attempts"];
  const errorRaw = payload["error"];
  if (!isQueueItemStatus(status)) return failPayload(row, "status");
  if (!isQueuePriority(priority)) return failPayload(row, "priority");
  if (!isFiniteNumber(durationMs)) return failPayload(row, "durationMs");
  if (!isFiniteNumber(attempts)) return failPayload(row, "attempts");
  const error =
    errorRaw === undefined
      ? undefined
      : isString(errorRaw)
        ? errorRaw
        : null;
  if (error === null) return failPayload(row, "error");
  return {
    id: row.id,
    type: "queue.item.completed",
    occurredAt: row.occurredAt.getTime(),
    entityType: "queue",
    entityId: row.entityId,
    attributes: decodeAttributes(row.attributes),
    item: {
      status,
      priority,
      durationMs,
      attempts,
      ...(error === undefined ? {} : { error }),
    },
  };
};

const decodeQueueLifecycle = (
  row: EffectPmEventRow,
): QueueLifecycleChangedEvent | ProcessStoreEventDecodeError => {
  if (row.entityType !== "queue") {
    return new ProcessStoreEventDecodeError({
      rowId: row.id,
      reason: `entityType must be "queue" for queue lifecycle events, got ${row.entityType}`,
    });
  }
  const payload = row.payload;
  if (!isRecord(payload)) {
    return new ProcessStoreEventDecodeError({
      rowId: row.id,
      reason: "payload is not an object",
    });
  }
  const tag = payload["tag"];
  const itemsCleared = payload["itemsCleared"];
  if (!isQueueLifecycleTag(tag)) return failPayload(row, "tag");
  if (itemsCleared !== undefined && !isFiniteNumber(itemsCleared)) {
    return failPayload(row, "itemsCleared");
  }
  return {
    id: row.id,
    type: "queue.lifecycle.changed",
    occurredAt: row.occurredAt.getTime(),
    entityType: "queue",
    entityId: row.entityId,
    attributes: decodeAttributes(row.attributes),
    lifecycle: {
      tag,
      ...(itemsCleared === undefined ? {} : { itemsCleared }),
    },
  };
};

const decodeRuntimeFact = (
  row: EffectPmEventRow,
): RuntimeFactRecordedEvent | ProcessStoreEventDecodeError => {
  const payload = row.payload;
  if (!isRecord(payload)) {
    return new ProcessStoreEventDecodeError({
      rowId: row.id,
      reason: "payload is not an object",
    });
  }
  const fact = decodeRuntimeFactValue(payload["fact"]);
  if (fact === null) {
    return failPayload(row, "fact");
  }
  return {
    id: row.id,
    type: "runtime.fact.recorded",
    occurredAt: row.occurredAt.getTime(),
    entityType: row.entityType,
    entityId: row.entityId,
    attributes: decodeAttributes(row.attributes),
    fact,
  };
};

const failPayload = (
  row: EffectPmEventRow,
  field: string,
): ProcessStoreEventDecodeError =>
  new ProcessStoreEventDecodeError({
    rowId: row.id,
    reason: `payload.${field} is missing or has the wrong type`,
  });

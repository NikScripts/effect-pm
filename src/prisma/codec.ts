/**
 * Encode/decode boundary between {@link AnalyticsEvent} (typed) and
 * {@link EffectPmEventRow} (Prisma-typed JSON columns).
 *
 * All decoders narrow {@link JsonValue} via predicates — no unsafe casts.
 *
 * @module ProcessStore/Prisma/Codec
 */

import { Data, DateTime, Option } from "effect";
import type {
  AnalyticsEvent,
  ProcessExecutionCompletedEvent,
  ProcessLifecycleChangedEvent,
  ProcessLifecycleTag,
  QueueItemCompletedEvent,
  QueueItemStatus,
  QueueLifecycleChangedEvent,
  QueueLifecycleTag,
} from "../ProcessStore";
import type {
  EffectPmEventCreateInput,
  EffectPmEventRow,
  JsonValue,
} from "./types";

// ============================================================================
// Errors
// ============================================================================

/**
 * Raised when a row read from the database does not conform to a known
 * {@link AnalyticsEvent} shape.
 *
 * @public
 */
export class PrismaProcessStoreDecodeError extends Data.TaggedError(
  "PrismaProcessStoreDecodeError",
)<{
  readonly rowId: string;
  readonly reason: string;
}> {}

// ============================================================================
// Narrowing primitives
// ============================================================================

const isObject = (value: unknown): value is { [key: string]: unknown } =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string =>
  typeof value === "string";

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isBoolean = (value: unknown): value is boolean =>
  typeof value === "boolean";

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
  (lifecycleTags as ReadonlyArray<string>).includes(value);

const executionStatuses: ReadonlyArray<
  ProcessExecutionCompletedEvent["execution"]["status"]
> = ["completed", "failed", "interrupted"];

const isExecutionStatus = (
  value: unknown,
): value is ProcessExecutionCompletedEvent["execution"]["status"] =>
  isString(value) && (executionStatuses as ReadonlyArray<string>).includes(value);

const queueItemStatuses: ReadonlyArray<QueueItemStatus> = [
  "completed",
  "failed",
  "retried",
  "exhausted",
];

const isQueueItemStatus = (value: unknown): value is QueueItemStatus =>
  isString(value) &&
  (queueItemStatuses as ReadonlyArray<string>).includes(value);

const queuePriorities: ReadonlyArray<QueueItemCompletedEvent["item"]["priority"]> = [
  "high",
  "normal",
  "low",
];

const isQueuePriority = (
  value: unknown,
): value is QueueItemCompletedEvent["item"]["priority"] =>
  isString(value) && (queuePriorities as ReadonlyArray<string>).includes(value);

const queueLifecycleTags: ReadonlyArray<QueueLifecycleTag> = [
  "Started",
  "Paused",
  "Resumed",
  "Shutdown",
  "Cleared",
];

const isQueueLifecycleTag = (value: unknown): value is QueueLifecycleTag =>
  isString(value) &&
  (queueLifecycleTags as ReadonlyArray<string>).includes(value);

const dateFromMillis = (millis: number): Date =>
  DateTime.toDateUtc(DateTime.makeUnsafe(millis));

const parseEpochMillis = (value: unknown): number | null => {
  if (isFiniteNumber(value)) {
    return value;
  }
  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isNaN(millis) ? null : millis;
  }
  if (isString(value)) {
    const parsed = DateTime.make(value);
    return Option.match(parsed, {
      onNone: () => null,
      onSome: (dateTime) => DateTime.toDateUtc(dateTime).getTime(),
    });
  }
  return null;
};

// ============================================================================
// Encoding (typed event -> Prisma create input)
// ============================================================================

/**
 * Convert an {@link AnalyticsEvent} into a Prisma `create`/`createMany` input.
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

/**
 * Convert an arbitrary JS value into a {@link JsonValue} structure.
 *
 * @remarks
 * - `undefined`, functions, symbols, and `bigint` collapse to `null`.
 * - `Date` is encoded as an ISO string.
 * - Arrays and plain objects recurse.
 *
 * @internal
 */
const toJsonValue = (value: unknown): JsonValue => {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (isString(value) || isFiniteNumber(value) || isBoolean(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(toJsonValue);
  }
  if (isObject(value)) {
    const out: { [key: string]: JsonValue } = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = toJsonValue(item);
    }
    return out;
  }
  return null;
};

// ============================================================================
// Decoding (Prisma row -> typed event)
// ============================================================================

/**
 * Decode a Prisma row into a typed {@link AnalyticsEvent}.
 *
 * @returns the event, or a {@link PrismaProcessStoreDecodeError} explaining
 * the mismatch when the row does not conform.
 *
 * @public
 */
export const decodeEventRow = (
  row: EffectPmEventRow,
): AnalyticsEvent | PrismaProcessStoreDecodeError => {
  switch (row.type) {
    case "process.execution.completed":
      return decodeExecution(row);
    case "process.lifecycle.changed":
      return decodeLifecycle(row);
    case "queue.item.completed":
      return decodeQueueItem(row);
    case "queue.lifecycle.changed":
      return decodeQueueLifecycle(row);
    default:
      return new PrismaProcessStoreDecodeError({
        rowId: row.id,
        reason: `unknown event type: ${row.type}`,
      });
  }
};

const decodeAttributes = (
  attributes: JsonValue | null,
): Record<string, unknown> | undefined => {
  if (attributes === null) return undefined;
  if (!isObject(attributes)) return undefined;
  const out: { [key: string]: unknown } = {};
  for (const [key, value] of Object.entries(attributes)) {
    out[key] = value;
  }
  return out;
};

const decodeExecution = (
  row: EffectPmEventRow,
): ProcessExecutionCompletedEvent | PrismaProcessStoreDecodeError => {
  if (row.entityType !== "process") {
    return new PrismaProcessStoreDecodeError({
      rowId: row.id,
      reason: `entityType must be "process" for execution events, got ${row.entityType}`,
    });
  }
  const payload = row.payload;
  if (!isObject(payload)) {
    return new PrismaProcessStoreDecodeError({
      rowId: row.id,
      reason: "payload is not an object",
    });
  }
  const startedAt = parseEpochMillis(payload["startedAt"]);
  const completedAt = parseEpochMillis(payload["completedAt"]);
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
): ProcessLifecycleChangedEvent | PrismaProcessStoreDecodeError => {
  if (row.entityType !== "process") {
    return new PrismaProcessStoreDecodeError({
      rowId: row.id,
      reason: `entityType must be "process" for lifecycle events, got ${row.entityType}`,
    });
  }
  const payload = row.payload;
  if (!isObject(payload)) {
    return new PrismaProcessStoreDecodeError({
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
): QueueItemCompletedEvent | PrismaProcessStoreDecodeError => {
  if (row.entityType !== "queue") {
    return new PrismaProcessStoreDecodeError({
      rowId: row.id,
      reason: `entityType must be "queue" for queue item events, got ${row.entityType}`,
    });
  }
  const payload = row.payload;
  if (!isObject(payload)) {
    return new PrismaProcessStoreDecodeError({
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
): QueueLifecycleChangedEvent | PrismaProcessStoreDecodeError => {
  if (row.entityType !== "queue") {
    return new PrismaProcessStoreDecodeError({
      rowId: row.id,
      reason: `entityType must be "queue" for queue lifecycle events, got ${row.entityType}`,
    });
  }
  const payload = row.payload;
  if (!isObject(payload)) {
    return new PrismaProcessStoreDecodeError({
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

const failPayload = (
  row: EffectPmEventRow,
  field: string,
): PrismaProcessStoreDecodeError =>
  new PrismaProcessStoreDecodeError({
    rowId: row.id,
    reason: `payload.${field} is missing or has the wrong type`,
  });

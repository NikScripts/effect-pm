/**
 * Encode/decode boundary between typed ProcessStore events and stored rows.
 *
 * @module ProcessStore/Codec
 */

import { Data } from "effect";
import type {
  AnalyticsEvent,
  LogEntryRecordedEvent,
  ProcessExecutionCompletedEvent,
  ProcessLifecycleChangedEvent,
  ProcessLifecycleTag,
  RunResourceFactRecordedEvent,
  RunResourceStateChangedEvent,
} from "../../ProcessStoreEvent";
import type {
  EffectPmEventCreateInput,
  EffectPmEventRow,
  JsonValue,
} from "../../ProcessStoreEvent";
import type {
  QueueDedupeKeyAddedChange,
  QueueDedupeKeyAddedEvent,
  QueueDedupeKeyChange,
  QueueDedupeKeyChangedEvent,
  QueueDedupeKeyHydratedChange,
  QueueDedupeKeyHydratedEvent,
  QueueDedupeKeyReleasedChange,
  QueueDedupeKeyReleasedEvent,
  QueueEntryCompletedEvent,
  QueueEntryCompletedFact,
  QueueEntryDeadLetteredEvent,
  QueueEntryDeadLetteredFact,
  QueueEntryDroppedEvent,
  QueueEntryDroppedFact,
  QueueEntryEnqueuedEvent,
  QueueEntryEnqueuedFact,
  QueueEntryExhaustedEvent,
  QueueEntryExhaustedFact,
  QueueEntryFact,
  QueueEntryFailedEvent,
  QueueEntryFailedFact,
  QueueEntryRecordedEvent,
  QueueEntryReleasedEvent,
  QueueEntryReleasedFact,
  QueueEntryRetriedEvent,
  QueueEntryRetriedFact,
  QueueEntryStartedEvent,
  QueueEntryStartedFact,
  QueueLifecycleChange,
  QueueLifecycleChangedEvent,
  QueueLifecycleClearedChange,
  QueueLifecycleClearedEvent,
  QueueLifecycleDrainedChange,
  QueueLifecycleDrainedEvent,
  QueueLifecyclePausedChange,
  QueueLifecyclePausedEvent,
  QueueLifecycleResumedChange,
  QueueLifecycleResumedEvent,
  QueueLifecycleShutdownChange,
  QueueLifecycleShutdownEvent,
  QueueLifecycleStartedChange,
  QueueLifecycleStartedEvent,
  ProcessStoreQueueResourcePriority,
} from "../../store/queueResource";
import type {
  RunResourceFact,
  RunResourceFactType,
  RunResourceState,
  RunResourceStateChange,
  RunResourceStateChangeReason,
} from "../../store/runResource";
import {
  dateFromMillis,
  epochMillisFromUnknown,
  isBoolean,
  isFiniteNumber,
  isJsonValue,
  isRecord,
  isString,
} from "../json";

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

const queuePriorities: ReadonlyArray<ProcessStoreQueueResourcePriority> = [
  "high",
  "normal",
  "low",
];

const isQueuePriority = (
  value: unknown,
): value is ProcessStoreQueueResourcePriority =>
  isString(value) && includesString(queuePriorities, value);

const runResourceFactTypes: ReadonlyArray<RunResourceFactType> = [
  "run-resource.run.started",
  "run-resource.run.completed",
  "run-resource.run.failed",
];

const isRunResourceFactType = (value: unknown): value is RunResourceFactType =>
  isString(value) && includesString(runResourceFactTypes, value);

const runResourceStateChangeReasons: ReadonlyArray<RunResourceStateChangeReason> = [
  "run-resource.run.waiting",
  "run-resource.run.started",
  "run-resource.run.completed",
  "run-resource.run.failed",
  "run-resource.run.interrupted",
  "run-resource.run.wait.interrupted",
];

const isRunResourceStateChangeReason = (
  value: unknown,
): value is RunResourceStateChangeReason =>
  isString(value) && includesString(runResourceStateChangeReasons, value);

const logLevels: ReadonlyArray<LogEntryRecordedEvent["log"]["entry"]["level"]> = [
  "All",
  "Fatal",
  "Error",
  "Warn",
  "Info",
  "Debug",
  "Trace",
  "None",
];

const isLogLevel = (
  value: unknown,
): value is LogEntryRecordedEvent["log"]["entry"]["level"] =>
  isString(value) && includesString(logLevels, value);

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
    case "queue.entry.enqueued":
    case "queue.entry.started":
    case "queue.entry.completed":
    case "queue.entry.failed":
    case "queue.entry.retried":
    case "queue.entry.exhausted":
    case "queue.entry.released":
    case "queue.entry.dead-lettered":
    case "queue.entry.dropped":
      return {
        id: event.id,
        type: event.type,
        occurredAt: dateFromMillis(event.occurredAt),
        entityType: event.entityType,
        entityId: event.entityId,
        attributes,
        payload: { fact: toJsonValue(event.fact) },
      };
    case "queue.lifecycle.started":
    case "queue.lifecycle.paused":
    case "queue.lifecycle.resumed":
    case "queue.lifecycle.shutdown":
    case "queue.lifecycle.cleared":
    case "queue.lifecycle.drained":
      return {
        id: event.id,
        type: event.type,
        occurredAt: dateFromMillis(event.occurredAt),
        entityType: event.entityType,
        entityId: event.entityId,
        attributes,
        payload: { change: toJsonValue(event.change) },
      };
    case "queue.dedupe-key.added":
    case "queue.dedupe-key.released":
    case "queue.dedupe-key.hydrated":
      return {
        id: event.id,
        type: event.type,
        occurredAt: dateFromMillis(event.occurredAt),
        entityType: event.entityType,
        entityId: event.entityId,
        attributes,
        payload: { change: toJsonValue(event.change) },
      };
    case "run-resource.fact.recorded":
      return {
        id: event.id,
        type: event.type,
        occurredAt: dateFromMillis(event.occurredAt),
        entityType: event.entityType,
        entityId: event.entityId,
        attributes,
        payload: encodeRunResourceFactPayload(event),
      };
    case "run-resource.state.changed":
      return {
        id: event.id,
        type: event.type,
        occurredAt: dateFromMillis(event.occurredAt),
        entityType: event.entityType,
        entityId: event.entityId,
        attributes,
        payload: encodeRunResourceStatePayload(event),
      };
    case "log.entry":
      return {
        id: event.id,
        type: event.type,
        occurredAt: dateFromMillis(event.occurredAt),
        entityType: event.entityType,
        entityId: event.entityId,
        attributes,
        payload: encodeLogEntryPayload(event),
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

const encodeRunResourceFactPayload = (
  event: RunResourceFactRecordedEvent,
): JsonValue => ({
  fact: toJsonValue(event.fact),
});

const encodeRunResourceStatePayload = (
  event: RunResourceStateChangedEvent,
): JsonValue => ({
  change: toJsonValue(event.change),
});

const encodeLogEntryPayload = (
  event: LogEntryRecordedEvent,
): JsonValue => ({
  entryId: event.log.entryId,
  entry: toJsonValue(event.log.entry),
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
    case "queue.entry.enqueued":
    case "queue.entry.started":
    case "queue.entry.completed":
    case "queue.entry.failed":
    case "queue.entry.retried":
    case "queue.entry.exhausted":
    case "queue.entry.released":
    case "queue.entry.dead-lettered":
    case "queue.entry.dropped":
      return decodeQueueEntryRecorded(row);
    case "queue.lifecycle.started":
    case "queue.lifecycle.paused":
    case "queue.lifecycle.resumed":
    case "queue.lifecycle.shutdown":
    case "queue.lifecycle.cleared":
    case "queue.lifecycle.drained":
      return decodeQueueLifecycleChanged(row);
    case "queue.dedupe-key.added":
    case "queue.dedupe-key.released":
    case "queue.dedupe-key.hydrated":
      return decodeQueueDedupeKeyChanged(row);
    case "run-resource.fact.recorded":
      return decodeRunResourceFact(row);
    case "run-resource.state.changed":
      return decodeRunResourceState(row);
    case "log.entry":
      return decodeLogEntry(row);
    default:
      return new ProcessStoreEventDecodeError({
        rowId: row.id,
        reason: `unknown event type: ${row.type}`,
      });
  }
};

const decodeRunResourceFactValue = (
  value: unknown,
): RunResourceFact | null => {
  if (!isRecord(value)) {
    return null;
  }
  const id = value["id"];
  const resourceId = value["resourceId"];
  const runId = value["runId"];
  const type = value["type"];
  const occurredAt = value["occurredAt"];
  const payload = value["payload"];
  if (
    !isString(id) ||
    !isString(resourceId) ||
    !isString(runId) ||
    !isRunResourceFactType(type) ||
    !isFiniteNumber(occurredAt) ||
    !isRecord(payload)
  ) {
    return null;
  }
  const attributes = decodeAttributes(
    value["attributes"] === undefined
      ? null
      : toJsonValue(value["attributes"]),
  );
  switch (type) {
    case "run-resource.run.started": {
      const concurrency = payload["concurrency"];
      if (!isFiniteNumber(concurrency)) return null;
      return {
        id,
        resourceId,
        runId,
        type,
        occurredAt,
        payload: { concurrency },
        ...(attributes === undefined ? {} : { attributes }),
      };
    }
    case "run-resource.run.completed": {
      const durationMs = payload["durationMs"];
      if (!isFiniteNumber(durationMs)) return null;
      return {
        id,
        resourceId,
        runId,
        type,
        occurredAt,
        payload: { durationMs },
        ...(attributes === undefined ? {} : { attributes }),
      };
    }
    case "run-resource.run.failed": {
      const durationMs = payload["durationMs"];
      const cause = payload["cause"];
      if (!isFiniteNumber(durationMs) || !isString(cause)) return null;
      return {
        id,
        resourceId,
        runId,
        type,
        occurredAt,
        payload: { durationMs, cause },
        ...(attributes === undefined ? {} : { attributes }),
      };
    }
  }
};

const decodeRunResourceStateValue = (
  value: unknown,
): RunResourceState | null => {
  if (!isRecord(value)) return null;
  const resourceId = value["resourceId"];
  const observedAt = value["observedAt"];
  const configVersion = value["configVersion"];
  const concurrency = value["concurrency"];
  const waiting = value["waiting"];
  const inFlight = value["inFlight"];
  const completed = value["completed"];
  const failed = value["failed"];
  const interrupted = value["interrupted"];
  const totalDurationMs = value["totalDurationMs"];
  if (
    !isString(resourceId) ||
    !isFiniteNumber(observedAt) ||
    !isFiniteNumber(configVersion) ||
    !isFiniteNumber(concurrency) ||
    !isFiniteNumber(waiting) ||
    !isFiniteNumber(inFlight) ||
    !isFiniteNumber(completed) ||
    !isFiniteNumber(failed) ||
    !isFiniteNumber(interrupted) ||
    !isFiniteNumber(totalDurationMs)
  ) {
    return null;
  }
  return {
    resourceId,
    observedAt,
    configVersion,
    concurrency,
    waiting,
    inFlight,
    completed,
    failed,
    interrupted,
    totalDurationMs,
  };
};

const decodeRunResourceStateChangeValue = (
  value: unknown,
): RunResourceStateChange | null => {
  if (!isRecord(value)) return null;
  const id = value["id"];
  const resourceId = value["resourceId"];
  const changedAt = value["changedAt"];
  const reason = value["reason"];
  const previousRaw = value["previous"];
  const previous =
    previousRaw === null ? null : decodeRunResourceStateValue(previousRaw);
  const current = decodeRunResourceStateValue(value["current"]);
  if (
    !isString(id) ||
    !isString(resourceId) ||
    !isFiniteNumber(changedAt) ||
    !isRunResourceStateChangeReason(reason) ||
    (previousRaw !== null && previous === null) ||
    current === null
  ) {
    return null;
  }
  return {
    id,
    resourceId,
    changedAt,
    reason,
    previous,
    current,
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

// ============================================================================
// Queue resource decoders
// ============================================================================

const QUEUE_RESOURCE_ENTITY_TYPE = "queue-resource";

interface QueueEntryFactCommonDecoded {
  readonly id: string;
  readonly queueId: string;
  readonly entryId: string;
  readonly occurredAt: number;
  readonly key: string | undefined;
  readonly priority: ProcessStoreQueueResourcePriority | undefined;
  readonly attempts: number | undefined;
  readonly batchId: string | undefined;
  readonly attributes: Record<string, unknown> | undefined;
}

const decodeQueueEntryFactCommon = (
  raw: { readonly [key: string]: unknown },
): QueueEntryFactCommonDecoded | null => {
  const id = raw["id"];
  const queueId = raw["queueId"];
  const entryId = raw["entryId"];
  const occurredAt = raw["occurredAt"];
  if (
    !isString(id) ||
    !isString(queueId) ||
    !isString(entryId) ||
    !isFiniteNumber(occurredAt)
  ) {
    return null;
  }

  const keyRaw = raw["key"];
  const priorityRaw = raw["priority"];
  const attemptsRaw = raw["attempts"];
  const batchIdRaw = raw["batchId"];

  if (keyRaw !== undefined && !isString(keyRaw)) return null;
  if (priorityRaw !== undefined && !isQueuePriority(priorityRaw)) return null;
  if (attemptsRaw !== undefined && !isFiniteNumber(attemptsRaw)) return null;
  if (batchIdRaw !== undefined && !isString(batchIdRaw)) return null;

  return {
    id,
    queueId,
    entryId,
    occurredAt,
    key: keyRaw,
    priority: priorityRaw,
    attempts: attemptsRaw,
    batchId: batchIdRaw,
    attributes: decodeAttributes(
      raw["attributes"] === undefined
        ? null
        : toJsonValue(raw["attributes"]),
    ),
  };
};

interface QueueEntryFactCommonExpanded {
  readonly id: string;
  readonly queueId: string;
  readonly entryId: string;
  readonly occurredAt: number;
  readonly key?: string;
  readonly priority?: ProcessStoreQueueResourcePriority;
  readonly attempts?: number;
  readonly batchId?: string;
  readonly attributes?: Record<string, unknown>;
}

const expandEntryCommon = (
  common: QueueEntryFactCommonDecoded,
): QueueEntryFactCommonExpanded => ({
  id: common.id,
  queueId: common.queueId,
  entryId: common.entryId,
  occurredAt: common.occurredAt,
  ...(common.key === undefined ? {} : { key: common.key }),
  ...(common.priority === undefined ? {} : { priority: common.priority }),
  ...(common.attempts === undefined ? {} : { attempts: common.attempts }),
  ...(common.batchId === undefined ? {} : { batchId: common.batchId }),
  ...(common.attributes === undefined ? {} : { attributes: common.attributes }),
});

const decodeQueueEntryEnqueuedFact = (
  raw: { readonly [key: string]: unknown },
): QueueEntryEnqueuedFact | null => {
  const common = decodeQueueEntryFactCommon(raw);
  if (common === null) return null;
  const enqueuedAt = raw["enqueuedAt"];
  if (!isFiniteNumber(enqueuedAt)) return null;
  const payload = raw["payload"];
  if (payload !== undefined && !isJsonValue(payload)) return null;
  return {
    ...expandEntryCommon(common),
    type: "queue.entry.enqueued",
    enqueuedAt,
    ...(payload === undefined ? {} : { payload }),
  };
};

const decodeQueueEntryStartedFact = (
  raw: { readonly [key: string]: unknown },
): QueueEntryStartedFact | null => {
  const common = decodeQueueEntryFactCommon(raw);
  if (common === null) return null;
  const startedAt = raw["startedAt"];
  if (!isFiniteNumber(startedAt)) return null;
  return {
    ...expandEntryCommon(common),
    type: "queue.entry.started",
    startedAt,
  };
};

const decodeQueueEntryCompletedFact = (
  raw: { readonly [key: string]: unknown },
): QueueEntryCompletedFact | null => {
  const common = decodeQueueEntryFactCommon(raw);
  if (common === null) return null;
  const startedAt = raw["startedAt"];
  const durationMs = raw["durationMs"];
  if (!isFiniteNumber(startedAt) || !isFiniteNumber(durationMs)) return null;
  return {
    ...expandEntryCommon(common),
    type: "queue.entry.completed",
    startedAt,
    durationMs,
  };
};

const decodeQueueEntryFailedFact = (
  raw: { readonly [key: string]: unknown },
): QueueEntryFailedFact | null => {
  const common = decodeQueueEntryFactCommon(raw);
  if (common === null) return null;
  const startedAt = raw["startedAt"];
  const durationMs = raw["durationMs"];
  const errorRaw = raw["error"];
  if (!isFiniteNumber(startedAt) || !isFiniteNumber(durationMs)) return null;
  if (errorRaw !== undefined && !isString(errorRaw)) return null;
  return {
    ...expandEntryCommon(common),
    type: "queue.entry.failed",
    startedAt,
    durationMs,
    ...(errorRaw === undefined ? {} : { error: errorRaw }),
  };
};

const decodeQueueEntryRetriedFact = (
  raw: { readonly [key: string]: unknown },
): QueueEntryRetriedFact | null => {
  const common = decodeQueueEntryFactCommon(raw);
  if (common === null) return null;
  const errorRaw = raw["error"];
  if (errorRaw !== undefined && !isString(errorRaw)) return null;
  return {
    ...expandEntryCommon(common),
    type: "queue.entry.retried",
    ...(errorRaw === undefined ? {} : { error: errorRaw }),
  };
};

const decodeQueueEntryExhaustedFact = (
  raw: { readonly [key: string]: unknown },
): QueueEntryExhaustedFact | null => {
  const common = decodeQueueEntryFactCommon(raw);
  if (common === null) return null;
  const errorRaw = raw["error"];
  if (errorRaw !== undefined && !isString(errorRaw)) return null;
  return {
    ...expandEntryCommon(common),
    type: "queue.entry.exhausted",
    ...(errorRaw === undefined ? {} : { error: errorRaw }),
  };
};

const decodeQueueEntryReleasedFact = (
  raw: { readonly [key: string]: unknown },
): QueueEntryReleasedFact | null => {
  const common = decodeQueueEntryFactCommon(raw);
  if (common === null) return null;
  const releaseId = raw["releaseId"];
  const interruptedAtRaw = raw["interruptedAt"];
  if (!isString(releaseId)) return null;
  if (interruptedAtRaw !== undefined && !isFiniteNumber(interruptedAtRaw)) {
    return null;
  }
  return {
    ...expandEntryCommon(common),
    type: "queue.entry.released",
    releaseId,
    ...(interruptedAtRaw === undefined
      ? {}
      : { interruptedAt: interruptedAtRaw }),
  };
};

const decodeQueueEntryDeadLetteredFact = (
  raw: { readonly [key: string]: unknown },
): QueueEntryDeadLetteredFact | null => {
  const common = decodeQueueEntryFactCommon(raw);
  if (common === null) return null;
  const reasonRaw = raw["reason"];
  const errorRaw = raw["error"];
  if (reasonRaw !== undefined && !isString(reasonRaw)) return null;
  if (errorRaw !== undefined && !isString(errorRaw)) return null;
  return {
    ...expandEntryCommon(common),
    type: "queue.entry.dead-lettered",
    ...(reasonRaw === undefined ? {} : { reason: reasonRaw }),
    ...(errorRaw === undefined ? {} : { error: errorRaw }),
  };
};

const decodeQueueEntryDroppedFact = (
  raw: { readonly [key: string]: unknown },
): QueueEntryDroppedFact | null => {
  const common = decodeQueueEntryFactCommon(raw);
  if (common === null) return null;
  const reasonRaw = raw["reason"];
  if (reasonRaw !== undefined && !isString(reasonRaw)) return null;
  return {
    ...expandEntryCommon(common),
    type: "queue.entry.dropped",
    ...(reasonRaw === undefined ? {} : { reason: reasonRaw }),
  };
};

const decodeQueueEntryRecorded = (
  row: EffectPmEventRow,
): QueueEntryRecordedEvent | ProcessStoreEventDecodeError => {
  if (row.entityType !== QUEUE_RESOURCE_ENTITY_TYPE) {
    return new ProcessStoreEventDecodeError({
      rowId: row.id,
      reason: `entityType must be "${QUEUE_RESOURCE_ENTITY_TYPE}" for queue entry events, got ${row.entityType}`,
    });
  }
  const payload = row.payload;
  if (!isRecord(payload)) {
    return new ProcessStoreEventDecodeError({
      rowId: row.id,
      reason: "payload is not an object",
    });
  }
  const factRaw = payload["fact"];
  if (!isRecord(factRaw)) return failPayload(row, "fact");
  if (factRaw["type"] !== row.type) return failPayload(row, "fact.type");
  const occurredAt = row.occurredAt.getTime();
  const entityId = row.entityId;
  const attributes = decodeAttributes(row.attributes);
  switch (row.type) {
    case "queue.entry.enqueued": {
      const fact = decodeQueueEntryEnqueuedFact(factRaw);
      if (fact === null) return failPayload(row, "fact");
      return {
        id: row.id,
        type: "queue.entry.enqueued",
        occurredAt,
        entityType: QUEUE_RESOURCE_ENTITY_TYPE,
        entityId,
        attributes,
        fact,
      };
    }
    case "queue.entry.started": {
      const fact = decodeQueueEntryStartedFact(factRaw);
      if (fact === null) return failPayload(row, "fact");
      return {
        id: row.id,
        type: "queue.entry.started",
        occurredAt,
        entityType: QUEUE_RESOURCE_ENTITY_TYPE,
        entityId,
        attributes,
        fact,
      };
    }
    case "queue.entry.completed": {
      const fact = decodeQueueEntryCompletedFact(factRaw);
      if (fact === null) return failPayload(row, "fact");
      return {
        id: row.id,
        type: "queue.entry.completed",
        occurredAt,
        entityType: QUEUE_RESOURCE_ENTITY_TYPE,
        entityId,
        attributes,
        fact,
      };
    }
    case "queue.entry.failed": {
      const fact = decodeQueueEntryFailedFact(factRaw);
      if (fact === null) return failPayload(row, "fact");
      return {
        id: row.id,
        type: "queue.entry.failed",
        occurredAt,
        entityType: QUEUE_RESOURCE_ENTITY_TYPE,
        entityId,
        attributes,
        fact,
      };
    }
    case "queue.entry.retried": {
      const fact = decodeQueueEntryRetriedFact(factRaw);
      if (fact === null) return failPayload(row, "fact");
      return {
        id: row.id,
        type: "queue.entry.retried",
        occurredAt,
        entityType: QUEUE_RESOURCE_ENTITY_TYPE,
        entityId,
        attributes,
        fact,
      };
    }
    case "queue.entry.exhausted": {
      const fact = decodeQueueEntryExhaustedFact(factRaw);
      if (fact === null) return failPayload(row, "fact");
      return {
        id: row.id,
        type: "queue.entry.exhausted",
        occurredAt,
        entityType: QUEUE_RESOURCE_ENTITY_TYPE,
        entityId,
        attributes,
        fact,
      };
    }
    case "queue.entry.released": {
      const fact = decodeQueueEntryReleasedFact(factRaw);
      if (fact === null) return failPayload(row, "fact");
      return {
        id: row.id,
        type: "queue.entry.released",
        occurredAt,
        entityType: QUEUE_RESOURCE_ENTITY_TYPE,
        entityId,
        attributes,
        fact,
      };
    }
    case "queue.entry.dead-lettered": {
      const fact = decodeQueueEntryDeadLetteredFact(factRaw);
      if (fact === null) return failPayload(row, "fact");
      return {
        id: row.id,
        type: "queue.entry.dead-lettered",
        occurredAt,
        entityType: QUEUE_RESOURCE_ENTITY_TYPE,
        entityId,
        attributes,
        fact,
      };
    }
    case "queue.entry.dropped": {
      const fact = decodeQueueEntryDroppedFact(factRaw);
      if (fact === null) return failPayload(row, "fact");
      return {
        id: row.id,
        type: "queue.entry.dropped",
        occurredAt,
        entityType: QUEUE_RESOURCE_ENTITY_TYPE,
        entityId,
        attributes,
        fact,
      };
    }
    default:
      return new ProcessStoreEventDecodeError({
        rowId: row.id,
        reason: `unsupported queue entry type: ${row.type}`,
      });
  }
};

interface QueueLifecycleChangeCommonDecoded {
  readonly id: string;
  readonly queueId: string;
  readonly changedAt: number;
  readonly attributes: Record<string, unknown> | undefined;
}

interface QueueLifecycleChangeCommonExpanded {
  readonly id: string;
  readonly queueId: string;
  readonly changedAt: number;
  readonly attributes?: Record<string, unknown>;
}

const decodeQueueLifecycleChangeCommon = (
  raw: { readonly [key: string]: unknown },
): QueueLifecycleChangeCommonDecoded | null => {
  const id = raw["id"];
  const queueId = raw["queueId"];
  const changedAt = raw["changedAt"];
  if (!isString(id) || !isString(queueId) || !isFiniteNumber(changedAt)) {
    return null;
  }
  return {
    id,
    queueId,
    changedAt,
    attributes: decodeAttributes(
      raw["attributes"] === undefined
        ? null
        : toJsonValue(raw["attributes"]),
    ),
  };
};

const expandLifecycleCommon = (
  common: QueueLifecycleChangeCommonDecoded,
): QueueLifecycleChangeCommonExpanded => ({
  id: common.id,
  queueId: common.queueId,
  changedAt: common.changedAt,
  ...(common.attributes === undefined ? {} : { attributes: common.attributes }),
});

const decodeQueueLifecycleChanged = (
  row: EffectPmEventRow,
): QueueLifecycleChangedEvent | ProcessStoreEventDecodeError => {
  if (row.entityType !== QUEUE_RESOURCE_ENTITY_TYPE) {
    return new ProcessStoreEventDecodeError({
      rowId: row.id,
      reason: `entityType must be "${QUEUE_RESOURCE_ENTITY_TYPE}" for queue lifecycle events, got ${row.entityType}`,
    });
  }
  const payload = row.payload;
  if (!isRecord(payload)) {
    return new ProcessStoreEventDecodeError({
      rowId: row.id,
      reason: "payload is not an object",
    });
  }
  const changeRaw = payload["change"];
  if (!isRecord(changeRaw)) return failPayload(row, "change");
  if (changeRaw["type"] !== row.type) return failPayload(row, "change.type");
  const common = decodeQueueLifecycleChangeCommon(changeRaw);
  if (common === null) return failPayload(row, "change");
  const occurredAt = row.occurredAt.getTime();
  const entityId = row.entityId;
  const attributes = decodeAttributes(row.attributes);
  const expanded = expandLifecycleCommon(common);
  switch (row.type) {
    case "queue.lifecycle.started": {
      const change: QueueLifecycleStartedChange = {
        ...expanded,
        type: "queue.lifecycle.started",
      };
      return {
        id: row.id,
        type: "queue.lifecycle.started",
        occurredAt,
        entityType: QUEUE_RESOURCE_ENTITY_TYPE,
        entityId,
        attributes,
        change,
      };
    }
    case "queue.lifecycle.paused": {
      const change: QueueLifecyclePausedChange = {
        ...expanded,
        type: "queue.lifecycle.paused",
      };
      return {
        id: row.id,
        type: "queue.lifecycle.paused",
        occurredAt,
        entityType: QUEUE_RESOURCE_ENTITY_TYPE,
        entityId,
        attributes,
        change,
      };
    }
    case "queue.lifecycle.resumed": {
      const change: QueueLifecycleResumedChange = {
        ...expanded,
        type: "queue.lifecycle.resumed",
      };
      return {
        id: row.id,
        type: "queue.lifecycle.resumed",
        occurredAt,
        entityType: QUEUE_RESOURCE_ENTITY_TYPE,
        entityId,
        attributes,
        change,
      };
    }
    case "queue.lifecycle.shutdown": {
      const change: QueueLifecycleShutdownChange = {
        ...expanded,
        type: "queue.lifecycle.shutdown",
      };
      return {
        id: row.id,
        type: "queue.lifecycle.shutdown",
        occurredAt,
        entityType: QUEUE_RESOURCE_ENTITY_TYPE,
        entityId,
        attributes,
        change,
      };
    }
    case "queue.lifecycle.cleared": {
      const itemsCleared = changeRaw["itemsCleared"];
      if (!isFiniteNumber(itemsCleared)) {
        return failPayload(row, "change.itemsCleared");
      }
      const change: QueueLifecycleClearedChange = {
        ...expanded,
        type: "queue.lifecycle.cleared",
        itemsCleared,
      };
      return {
        id: row.id,
        type: "queue.lifecycle.cleared",
        occurredAt,
        entityType: QUEUE_RESOURCE_ENTITY_TYPE,
        entityId,
        attributes,
        change,
      };
    }
    case "queue.lifecycle.drained": {
      const change: QueueLifecycleDrainedChange = {
        ...expanded,
        type: "queue.lifecycle.drained",
      };
      return {
        id: row.id,
        type: "queue.lifecycle.drained",
        occurredAt,
        entityType: QUEUE_RESOURCE_ENTITY_TYPE,
        entityId,
        attributes,
        change,
      };
    }
    default:
      return new ProcessStoreEventDecodeError({
        rowId: row.id,
        reason: `unsupported queue lifecycle type: ${row.type}`,
      });
  }
};

interface QueueDedupeKeyChangeCommonDecoded {
  readonly id: string;
  readonly queueId: string;
  readonly key: string;
  readonly changedAt: number;
  readonly attributes: Record<string, unknown> | undefined;
}

interface QueueDedupeKeyChangeCommonExpanded {
  readonly id: string;
  readonly queueId: string;
  readonly key: string;
  readonly changedAt: number;
  readonly attributes?: Record<string, unknown>;
}

const decodeQueueDedupeKeyChangeCommon = (
  raw: { readonly [key: string]: unknown },
): QueueDedupeKeyChangeCommonDecoded | null => {
  const id = raw["id"];
  const queueId = raw["queueId"];
  const key = raw["key"];
  const changedAt = raw["changedAt"];
  if (
    !isString(id) ||
    !isString(queueId) ||
    !isString(key) ||
    !isFiniteNumber(changedAt)
  ) {
    return null;
  }
  return {
    id,
    queueId,
    key,
    changedAt,
    attributes: decodeAttributes(
      raw["attributes"] === undefined
        ? null
        : toJsonValue(raw["attributes"]),
    ),
  };
};

const expandDedupeCommon = (
  common: QueueDedupeKeyChangeCommonDecoded,
): QueueDedupeKeyChangeCommonExpanded => ({
  id: common.id,
  queueId: common.queueId,
  key: common.key,
  changedAt: common.changedAt,
  ...(common.attributes === undefined ? {} : { attributes: common.attributes }),
});

const decodeQueueDedupeKeyChanged = (
  row: EffectPmEventRow,
): QueueDedupeKeyChangedEvent | ProcessStoreEventDecodeError => {
  if (row.entityType !== QUEUE_RESOURCE_ENTITY_TYPE) {
    return new ProcessStoreEventDecodeError({
      rowId: row.id,
      reason: `entityType must be "${QUEUE_RESOURCE_ENTITY_TYPE}" for queue dedupe-key events, got ${row.entityType}`,
    });
  }
  const payload = row.payload;
  if (!isRecord(payload)) {
    return new ProcessStoreEventDecodeError({
      rowId: row.id,
      reason: "payload is not an object",
    });
  }
  const changeRaw = payload["change"];
  if (!isRecord(changeRaw)) return failPayload(row, "change");
  if (changeRaw["type"] !== row.type) return failPayload(row, "change.type");
  const common = decodeQueueDedupeKeyChangeCommon(changeRaw);
  if (common === null) return failPayload(row, "change");
  const occurredAt = row.occurredAt.getTime();
  const entityId = row.entityId;
  const attributes = decodeAttributes(row.attributes);
  const expanded = expandDedupeCommon(common);
  switch (row.type) {
    case "queue.dedupe-key.added": {
      const change: QueueDedupeKeyAddedChange = {
        ...expanded,
        type: "queue.dedupe-key.added",
      };
      return {
        id: row.id,
        type: "queue.dedupe-key.added",
        occurredAt,
        entityType: QUEUE_RESOURCE_ENTITY_TYPE,
        entityId,
        attributes,
        change,
      };
    }
    case "queue.dedupe-key.released": {
      const change: QueueDedupeKeyReleasedChange = {
        ...expanded,
        type: "queue.dedupe-key.released",
      };
      return {
        id: row.id,
        type: "queue.dedupe-key.released",
        occurredAt,
        entityType: QUEUE_RESOURCE_ENTITY_TYPE,
        entityId,
        attributes,
        change,
      };
    }
    case "queue.dedupe-key.hydrated": {
      const change: QueueDedupeKeyHydratedChange = {
        ...expanded,
        type: "queue.dedupe-key.hydrated",
      };
      return {
        id: row.id,
        type: "queue.dedupe-key.hydrated",
        occurredAt,
        entityType: QUEUE_RESOURCE_ENTITY_TYPE,
        entityId,
        attributes,
        change,
      };
    }
    default:
      return new ProcessStoreEventDecodeError({
        rowId: row.id,
        reason: `unsupported queue dedupe-key type: ${row.type}`,
      });
  }
};

const decodeRunResourceFact = (
  row: EffectPmEventRow,
): RunResourceFactRecordedEvent | ProcessStoreEventDecodeError => {
  if (row.entityType !== "run-resource") {
    return new ProcessStoreEventDecodeError({
      rowId: row.id,
      reason: `entityType must be "run-resource" for run-resource fact events, got ${row.entityType}`,
    });
  }
  const payload = row.payload;
  if (!isRecord(payload)) {
    return new ProcessStoreEventDecodeError({
      rowId: row.id,
      reason: "payload is not an object",
    });
  }
  const fact = decodeRunResourceFactValue(payload["fact"]);
  if (fact === null) {
    return failPayload(row, "fact");
  }
  return {
    id: row.id,
    type: "run-resource.fact.recorded",
    occurredAt: row.occurredAt.getTime(),
    entityType: "run-resource",
    entityId: row.entityId,
    attributes: decodeAttributes(row.attributes),
    fact,
  };
};

const decodeRunResourceState = (
  row: EffectPmEventRow,
): RunResourceStateChangedEvent | ProcessStoreEventDecodeError => {
  if (row.entityType !== "run-resource") {
    return new ProcessStoreEventDecodeError({
      rowId: row.id,
      reason: `entityType must be "run-resource" for run-resource state events, got ${row.entityType}`,
    });
  }
  const payload = row.payload;
  if (!isRecord(payload)) {
    return new ProcessStoreEventDecodeError({
      rowId: row.id,
      reason: "payload is not an object",
    });
  }
  const change = decodeRunResourceStateChangeValue(payload["change"]);
  if (change === null) {
    return failPayload(row, "change");
  }
  return {
    id: row.id,
    type: "run-resource.state.changed",
    occurredAt: row.occurredAt.getTime(),
    entityType: "run-resource",
    entityId: row.entityId,
    attributes: decodeAttributes(row.attributes),
    change,
  };
};

const decodeLogEntryPayload = (
  value: unknown,
): LogEntryRecordedEvent["log"]["entry"] | null => {
  if (!isRecord(value)) {
    return null;
  }
  const date = value["date"];
  const level = value["level"];
  const message = value["message"];
  const cause = value["cause"];
  const annotations = value["annotations"];
  const spans = value["spans"];
  if (!isString(date) || !isLogLevel(level) || !isString(message)) {
    return null;
  }
  if (!isRecord(annotations)) {
    return null;
  }
  const annotationOut: Record<string, string> = {};
  for (const [key, item] of Object.entries(annotations)) {
    if (!isString(item)) {
      return null;
    }
    annotationOut[key] = item;
  }
  if (!Array.isArray(spans)) {
    return null;
  }
  const spanOut: string[] = [];
  for (const span of spans) {
    if (!isString(span)) {
      return null;
    }
    spanOut.push(span);
  }
  return {
    date,
    level,
    message,
    ...(isString(cause) ? { cause } : {}),
    annotations: annotationOut,
    spans: spanOut,
  };
};

const decodeLogEntry = (
  row: EffectPmEventRow,
): LogEntryRecordedEvent | ProcessStoreEventDecodeError => {
  const payload = row.payload;
  if (!isRecord(payload)) {
    return new ProcessStoreEventDecodeError({
      rowId: row.id,
      reason: "payload is not an object",
    });
  }
  const entryId = payload["entryId"];
  const entry = decodeLogEntryPayload(payload["entry"]);
  if (!isString(entryId) || entry === null) {
    return failPayload(row, "log");
  }
  return {
    id: row.id,
    type: "log.entry",
    occurredAt: row.occurredAt.getTime(),
    entityType: "log",
    entityId: row.entityId,
    attributes: decodeAttributes(row.attributes),
    log: { entryId, entry },
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

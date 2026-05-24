/**
 * Storage-neutral event row shapes and analytics event types for {@link ProcessStore}.
 *
 * @module ProcessStoreEvent
 */

import { Data } from "effect";
import type { RuntimeFact, RuntimeRef, RuntimeStateChange } from "./RuntimeState";

/**
 * Structural JSON value compatible with persisted event payloads.
 *
 * @public
 */
export type JsonValue =
  | null
  | string
  | number
  | boolean
  | { readonly [key: string]: JsonValue }
  | ReadonlyArray<JsonValue>;

/**
 * Row shape persisted by storage adapters.
 *
 * @public
 */
export interface EffectPmEventRow {
  readonly id: string;
  readonly type: string;
  readonly occurredAt: Date;
  readonly entityType: string;
  readonly entityId: string;
  readonly attributes: JsonValue | null;
  readonly payload: JsonValue;
  readonly createdAt: Date;
}

/**
 * Create input used by append-style storage adapters.
 *
 * @internal
 */
export interface EffectPmEventCreateInput {
  readonly id: string;
  readonly type: string;
  readonly occurredAt: Date;
  readonly entityType: string;
  readonly entityId: string;
  readonly attributes?: JsonValue | null;
  readonly payload: JsonValue;
}

/**
 * Pagination / time window for historical reads.
 *
 * @public
 */
export interface QueryOpts {
  limit?: number;
  /** Filter: only events before this epoch millis. */
  before?: number;
  /** Filter: only events after this epoch millis. */
  after?: number;
}

/**
 * Storage-neutral event query for the append-only analytics envelope.
 *
 * @public
 */
export interface StoreEventQuery {
  readonly entityType?: AnalyticsEvent["entityType"];
  readonly entityId?: string;
  readonly types?: ReadonlyArray<AnalyticsEvent["type"]>;
  readonly opts?: QueryOpts;
}

/**
 * Storage-neutral query for persisted runtime facts.
 *
 * @public
 */
export interface RuntimeFactQuery {
  readonly ref?: RuntimeRef;
  readonly types?: ReadonlyArray<RuntimeFact["type"]>;
  readonly opts?: QueryOpts;
}

/**
 * Storage-neutral query for persisted runtime state changes.
 *
 * @public
 */
export interface RuntimeStateHistoryQuery {
  readonly ref: RuntimeRef;
  readonly opts?: QueryOpts;
}

/** @public */
export class ProcessStoreDuplicateRecordError extends Data.TaggedError(
  "ProcessStoreDuplicateRecordError",
)<{
  readonly id: string;
}> {}

/** @public */
export class ProcessStoreReadonlyRecordError extends Data.TaggedError(
  "ProcessStoreReadonlyRecordError",
)<{
  readonly id: string;
}> {}

/** @public */
export type ProcessStoreWriteError =
  | ProcessStoreDuplicateRecordError
  | ProcessStoreReadonlyRecordError;

/**
 * Common fields for every stored analytics row.
 *
 * @public
 */
export interface AnalyticsEventBase {
  id: string;
  type: string;
  /** Epoch milliseconds when the event occurred. Use `Clock.currentTimeMillis` to produce. */
  occurredAt: number;
  entityType: string;
  entityId: string;
  attributes?: Record<string, unknown>;
}

/**
 * Terminal status for a tracked process run.
 *
 * @public
 */
export type ProcessExecutionStatus = "completed" | "failed" | "interrupted";

/**
 * Facet-aligned write input for one finished process run.
 *
 * @remarks
 * Used by {@link Process} today via the legacy `ProcessStore` bridge; the target
 * is `ProcessStoreProcessExecution` (internal facet, Part C build step).
 *
 * @public
 */
export interface ProcessExecutionRecordInput {
  readonly processId: string;
  readonly scheduleKey: string | null;
  /** Epoch millis when the execution started. */
  readonly startedAt: number;
  /** Epoch millis when the execution completed. */
  readonly completedAt: number;
  readonly status: ProcessExecutionStatus;
  readonly error?: string;
  readonly isStartupRun: boolean;
}

/**
 * Query for process execution history (process id + optional time window / schedule key).
 *
 * @public
 */
export interface ProcessExecutionQuery {
  readonly processId: string;
  readonly scheduleKey?: string | null;
  readonly opts?: QueryOpts;
}

/**
 * One finished process run (success, failure, or interrupt).
 *
 * @public
 */
export interface ProcessExecutionCompletedEvent extends AnalyticsEventBase {
  type: "process.execution.completed";
  entityType: "process";
  execution: {
    scheduleKey: string | null;
    /** Epoch millis when the execution started. */
    startedAt: number;
    /** Epoch millis when the execution completed. */
    completedAt: number;
    durationMs: number;
    status: ProcessExecutionStatus;
    error?: string;
    isStartupRun: boolean;
  };
}

/**
 * High-level lifecycle labels written by the process supervisor.
 *
 * @public
 */
export type ProcessLifecycleTag =
  | "Started"
  | "Stopped"
  | "Restarted"
  | "Errored"
  | "Recovered"
  | "Disabled"
  | "Enabled";

/**
 * Supervisor-observed lifecycle transition for a process id.
 *
 * @public
 */
export interface ProcessLifecycleChangedEvent extends AnalyticsEventBase {
  type: "process.lifecycle.changed";
  entityType: "process";
  lifecycle: {
    tag: ProcessLifecycleTag;
    error?: string;
  };
}

/** @public */
export type QueueItemStatus = "completed" | "failed" | "retried" | "exhausted";

/** @public */
export interface QueueItemCompletedEvent extends AnalyticsEventBase {
  type: "queue.item.completed";
  entityType: "queue";
  item: {
    status: QueueItemStatus;
    priority: "high" | "normal" | "low";
    durationMs: number;
    attempts: number;
    error?: string;
  };
}

/** @public */
export type QueueLifecycleTag =
  | "Started"
  | "Paused"
  | "Resumed"
  | "Shutdown"
  | "Cleared";

/** @public */
export interface QueueLifecycleChangedEvent extends AnalyticsEventBase {
  type: "queue.lifecycle.changed";
  entityType: "queue";
  lifecycle: {
    tag: QueueLifecycleTag;
    itemsCleared?: number;
  };
}

/**
 * Generic runtime fact persisted through the current analytics event envelope.
 *
 * @public
 */
export interface RuntimeFactRecordedEvent extends AnalyticsEventBase {
  type: "runtime.fact.recorded";
  fact: RuntimeFact;
}

/**
 * Generic runtime state transition persisted through the analytics envelope.
 *
 * @public
 */
export interface RuntimeStateChangedEvent extends AnalyticsEventBase {
  type: "runtime.state.changed";
  change: RuntimeStateChange;
}

/**
 * Structured group log line persisted for operator `pm logs` history.
 *
 * @public
 */
export interface GroupLogEntryRecordedEvent extends AnalyticsEventBase {
  type: "group.log.entry";
  entityType: "group";
  log: {
    readonly entryId: string;
    readonly entry: {
      readonly date: string;
      readonly level: string;
      readonly message: string;
      readonly cause?: string;
      readonly annotations: Readonly<Record<string, string>>;
      readonly spans: ReadonlyArray<string>;
    };
  };
}

/**
 * Closed union of supported analytics payloads.
 *
 * @public
 */
export type AnalyticsEvent =
  | ProcessExecutionCompletedEvent
  | ProcessLifecycleChangedEvent
  | QueueItemCompletedEvent
  | QueueLifecycleChangedEvent
  | RuntimeFactRecordedEvent
  | RuntimeStateChangedEvent
  | GroupLogEntryRecordedEvent;

/**
 * @public
 */
export const isGroupLogEntryRecorded = (
  event: AnalyticsEvent,
): event is GroupLogEntryRecordedEvent =>
  event.type === "group.log.entry" && event.entityType === "group";

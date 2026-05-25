/**
 * Storage-neutral event row shapes and analytics event types for {@link ProcessStore}.
 *
 * @module ProcessStoreEvent
 */

import { Data } from "effect";
import type { LogLevel } from "effect/LogLevel";
import type {
  QueueDedupeKeyChangedEvent,
  QueueEntryRecordedEvent,
  QueueLifecycleChangedEvent,
} from "./store/queueResource";
import type {
  RunResourceFact,
  RunResourceStateChange,
} from "./store/runResource";

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

export type {
  QueueDedupeKeyChangedEvent,
  QueueEntryRecordedEvent,
  QueueLifecycleChangedEvent,
} from "./store/queueResource";

/**
 * Per-domain wire event for a {@link RunResourceFact} written by
 * {@link ProcessStoreRunResource}. Wire type: `"run-resource.fact.recorded"`.
 *
 * @public
 */
export interface RunResourceFactRecordedEvent extends AnalyticsEventBase {
  type: "run-resource.fact.recorded";
  entityType: "run-resource";
  fact: RunResourceFact;
}

/**
 * Per-domain wire event for a {@link RunResourceStateChange} written by
 * {@link ProcessStoreRunResource}. Wire type: `"run-resource.state.changed"`.
 *
 * @public
 */
export interface RunResourceStateChangedEvent extends AnalyticsEventBase {
  type: "run-resource.state.changed";
  entityType: "run-resource";
  change: RunResourceStateChange;
}

/**
 * Structured log line persisted by {@link ProcessStoreLog} for operator
 * `pm logs` / `pm watch` history. `entityId` is an opaque log-bucket id
 * supplied by the relay (today: the PM log annotation).
 *
 * @public
 */
export interface LogEntryRecordedEvent extends AnalyticsEventBase {
  type: "log.entry";
  entityType: "log";
  log: {
    readonly entryId: string;
    readonly entry: {
      readonly date: string;
      readonly level: LogLevel;
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
 * @remarks
 * Per-domain facets contribute concrete event types here. There is no
 * shared envelope wire type — see `docs/STORAGE.md`.
 *
 * @public
 */
export type AnalyticsEvent =
  | ProcessExecutionCompletedEvent
  | ProcessLifecycleChangedEvent
  | QueueEntryRecordedEvent
  | QueueLifecycleChangedEvent
  | QueueDedupeKeyChangedEvent
  | RunResourceFactRecordedEvent
  | RunResourceStateChangedEvent
  | LogEntryRecordedEvent;

/**
 * Narrows an {@link AnalyticsEvent} to {@link LogEntryRecordedEvent}.
 *
 * @public
 */
export const isLogEntryRecorded = (
  event: AnalyticsEvent,
): event is LogEntryRecordedEvent =>
  event.type === "log.entry" && event.entityType === "log";

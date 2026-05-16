/**
 * **ProcessStore** — event-first analytics for processes (and future queue metrics).
 *
 * @remarks
 * Intentionally small surface:
 *
 * - **Append** — `append` / `appendBatch` only (no update/delete in the interface).
 * - **Envelope** — {@link AnalyticsEventBase} carries `occurredAt`, `entityType`, `entityId`.
 * - **Events** — `process.execution.completed` and `process.lifecycle.changed` to start;
 *   Prisma adapter stores the same shapes durably.
 *
 * Default implementation: {@link ProcessStore} service class with an in-memory store;
 * use {@link ProcessStore.layer} in tests and demos.
 *
 * @module ProcessStore
 */

import { Context, Effect, Layer } from "effect";
import type { RuntimeFact } from "./RuntimeState";

// ============================================================================
// Public Types
// ============================================================================

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
    status: "completed" | "failed" | "interrupted";
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

// ============================================================================
// Queue Event Types
// ============================================================================

export type QueueItemStatus = "completed" | "failed" | "retried" | "exhausted";

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

export type QueueLifecycleTag =
  | "Started"
  | "Paused"
  | "Resumed"
  | "Shutdown"
  | "Cleared";

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
 * @remarks
 * This bridges Phase C runtime facts into today's `ProcessStore` append API
 * without adding a storage method for every runtime feature.
 *
 * @public
 */
export interface RuntimeFactRecordedEvent extends AnalyticsEventBase {
  type: "runtime.fact.recorded";
  fact: RuntimeFact;
}

// ============================================================================
// Event Union
// ============================================================================

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
  | RuntimeFactRecordedEvent;

/**
 * Storage port implemented by the in-memory service and the Prisma-backed adapter
 * (`@nikscripts/effect-pm/prisma`).
 *
 * @public
 */
export interface ProcessStoreInterface {
  append: (event: AnalyticsEvent) => Effect.Effect<void>;
  appendBatch: (events: ReadonlyArray<AnalyticsEvent>) => Effect.Effect<void>;
  events: (query?: StoreEventQuery) => Effect.Effect<AnalyticsEvent[]>;
  getProcessExecutions: (
    processId: string,
    opts?: QueryOpts,
  ) => Effect.Effect<ProcessExecutionCompletedEvent[]>;
  getProcessLifecycle: (
    processId: string,
    opts?: QueryOpts,
  ) => Effect.Effect<ProcessLifecycleChangedEvent[]>;
}

// ============================================================================
// Internal Helpers
// ============================================================================

const applyQueryOpts = <T>(
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

const byTimestampDesc = <T>(getTimestamp: (row: T) => number) => (a: T, b: T) =>
  getTimestamp(b) - getTimestamp(a);

const matchesStoreEventQuery =
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

// ============================================================================
// In-memory implementation
// ============================================================================

const makeInMemoryProcessStore = Effect.sync<ProcessStoreInterface>(() => {
  const events: AnalyticsEvent[] = [];

  return {
    append: (event) =>
      Effect.sync(() => {
        events.push(event);
      }),

    appendBatch: (batch) =>
      Effect.sync(() => {
        for (const event of batch) {
          events.push(event);
        }
      }),

    events: (query) =>
      Effect.sync(() => {
        const rows = events
          .filter(matchesStoreEventQuery(query))
          .sort(byTimestampDesc((event) => event.occurredAt));
        return applyQueryOpts(rows, query?.opts, (event) => event.occurredAt);
      }),

    getProcessExecutions: (processId, opts) =>
      Effect.sync(() => {
        const rows = events
          .filter(
            (event): event is ProcessExecutionCompletedEvent =>
              event.type === "process.execution.completed" &&
              event.entityType === "process" &&
              event.entityId === processId,
          )
          .sort(byTimestampDesc((event) => event.occurredAt));
        return applyQueryOpts(rows, opts, (event) => event.occurredAt);
      }),

    getProcessLifecycle: (processId, opts) =>
      Effect.sync(() => {
        const rows = events
          .filter(
            (event): event is ProcessLifecycleChangedEvent =>
              event.type === "process.lifecycle.changed" &&
              event.entityType === "process" &&
              event.entityId === processId,
          )
          .sort(byTimestampDesc((event) => event.occurredAt));
        return applyQueryOpts(rows, opts, (event) => event.occurredAt);
      }),
  };
});

// ============================================================================
// Public Service
// ============================================================================

/**
 * Context tag for {@link ProcessStoreInterface} (in-memory implementation by default).
 *
 * @public
 */
export class ProcessStore extends Context.Service<
  ProcessStore,
  ProcessStoreInterface
>()("@nikscripts/effect-pm/ProcessStore", {
  make: makeInMemoryProcessStore,
}) {}

export namespace ProcessStore {
  /**
   * `Layer` that provides {@link ProcessStore} backed by an in-memory event list.
   *
   * @public
   */
  export const layer = Layer.effect(ProcessStore, makeInMemoryProcessStore);
  /**
   * Raw `Effect` that materializes {@link ProcessStoreInterface} (no `Layer` wrapper).
   * Useful in tests that call `Effect.provideService` manually.
   *
   * @public
   */
  export const memory = makeInMemoryProcessStore;
}


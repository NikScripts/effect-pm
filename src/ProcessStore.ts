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
  before?: Date;
  after?: Date;
}

/**
 * Common fields for every stored analytics row.
 *
 * @public
 */
export interface AnalyticsEventBase {
  id: string;
  type: string;
  occurredAt: Date;
  entityType: "process" | "queue";
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
    startedAt: Date;
    completedAt: Date;
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

/**
 * Closed union of supported analytics payloads.
 *
 * @public
 */
export type AnalyticsEvent =
  | ProcessExecutionCompletedEvent
  | ProcessLifecycleChangedEvent;

/**
 * Storage port implemented by the in-memory service and {@link PrismaProcessStore}.
 *
 * @public
 */
export interface ProcessStoreInterface {
  append: (event: AnalyticsEvent) => Effect.Effect<void>;
  appendBatch: (events: ReadonlyArray<AnalyticsEvent>) => Effect.Effect<void>;
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
  getDate: (row: T) => Date,
): T[] => {
  const filtered = rows.filter((row) => {
    const timestamp = getDate(row).getTime();
    if (opts?.before !== undefined && timestamp >= opts.before.getTime()) {
      return false;
    }
    if (opts?.after !== undefined && timestamp <= opts.after.getTime()) {
      return false;
    }
    return true;
  });

  if (opts?.limit === undefined) {
    return filtered;
  }

  return filtered.slice(0, Math.max(0, opts.limit));
};

const byDateDesc = <T>(getDate: (row: T) => Date) => (a: T, b: T) =>
  getDate(b).getTime() - getDate(a).getTime();

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

    getProcessExecutions: (processId, opts) =>
      Effect.sync(() => {
        const rows = events
          .filter(
            (event): event is ProcessExecutionCompletedEvent =>
              event.type === "process.execution.completed" &&
              event.entityType === "process" &&
              event.entityId === processId,
          )
          .sort(byDateDesc((event) => event.execution.startedAt));
        return applyQueryOpts(rows, opts, (event) => event.execution.startedAt);
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
          .sort(byDateDesc((event) => event.occurredAt));
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


/**
 * ProcessStore - Event-first analytics foundation
 *
 * This is intentionally minimal and extensible:
 * - one append path (`append`)
 * - one envelope (`AnalyticsEventBase`)
 * - a small initial event set for process execution + lifecycle
 *
 * @module ProcessStore
 */

import { Context, Effect, Layer } from "effect";

// ============================================================================
// Public Types
// ============================================================================

export interface QueryOpts {
  limit?: number;
  before?: Date;
  after?: Date;
}

export interface AnalyticsEventBase {
  id: string;
  type: string;
  occurredAt: Date;
  entityType: "process" | "queue";
  entityId: string;
  attributes?: Record<string, unknown>;
}

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

export type ProcessLifecycleTag =
  | "Started"
  | "Stopped"
  | "Restarted"
  | "Errored"
  | "Recovered"
  | "Disabled"
  | "Enabled";

export interface ProcessLifecycleChangedEvent extends AnalyticsEventBase {
  type: "process.lifecycle.changed";
  entityType: "process";
  lifecycle: {
    tag: ProcessLifecycleTag;
    error?: string;
  };
}

export type AnalyticsEvent =
  | ProcessExecutionCompletedEvent
  | ProcessLifecycleChangedEvent;

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

export class ProcessStore extends Context.Service<
  ProcessStore,
  ProcessStoreInterface
>()("@nikscripts/effect-pm/ProcessStore", {
  make: makeInMemoryProcessStore,
}) {}

export namespace ProcessStore {
  export const layer = Layer.effect(ProcessStore, makeInMemoryProcessStore);
  export const memory = makeInMemoryProcessStore;
}


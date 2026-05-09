/**
 * ProcessStore - Unified analytics and storage service
 *
 * Replaces process-only execution history with a single service that can store:
 * - process execution records
 * - process lifecycle events
 * - process schedule switch events
 * - queue lifecycle records
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

export interface ExecutionRecord {
  id: string;
  processId: string;
  scheduleKey: string | null;
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
  status: "completed" | "failed" | "interrupted";
  error?: unknown;
  metadata?: Record<string, unknown>;
}

export interface ScheduleSwitchEvent {
  processId: string;
  from: string | null;
  to: string | null;
  switchedAt: Date;
}

export interface LifecycleEvent {
  processId: string;
  event:
    | { _tag: "Started" }
    | { _tag: "Stopped" }
    | { _tag: "Restarted" }
    | { _tag: "Errored"; error: unknown }
    | { _tag: "Recovered" }
    | { _tag: "Disabled" }
    | { _tag: "Enabled" };
  occurredAt: Date;
  metadata?: Record<string, unknown>;
}

export interface EnqueuedRecord<T> {
  id: string;
  key?: string;
  resourceId: string;
  item: T;
  priority: "high" | "normal" | "low";
  enqueuedAt: Date;
  hasForkWith: boolean;
}

export interface EffectCompleteRecord<T, R, E> extends EnqueuedRecord<T> {
  effect: {
    status: "success" | "failure" | "defect" | "interrupted";
    value?: R;
    error?: E;
    defect?: unknown;
    startedAt: Date;
    completedAt: Date;
    durationMs: number;
  };
}

export interface ForkCompleteRecord<T, R, E> extends EffectCompleteRecord<T, R, E> {
  fork: {
    status: "success" | "defect" | "interrupted";
    defect?: unknown;
    startedAt: Date;
    completedAt: Date;
    durationMs: number;
  };
}

export type QueueRecord<T, R, E> =
  | EnqueuedRecord<T>
  | EffectCompleteRecord<T, R, E>
  | ForkCompleteRecord<T, R, E>;

export interface ProcessStoreInterface {
  recordExecution: (record: ExecutionRecord) => Effect.Effect<void>;
  getExecutions: (
    processId: string,
    opts?: QueryOpts,
  ) => Effect.Effect<ExecutionRecord[]>;
  recordScheduleSwitch: (event: ScheduleSwitchEvent) => Effect.Effect<void>;
  getScheduleHistory: (
    processId: string,
    opts?: QueryOpts,
  ) => Effect.Effect<ScheduleSwitchEvent[]>;
  recordLifecycleEvent: (event: LifecycleEvent) => Effect.Effect<void>;
  getLifecycleHistory: (
    processId: string,
    opts?: QueryOpts,
  ) => Effect.Effect<LifecycleEvent[]>;
  pool: {
    onEnqueued: (record: EnqueuedRecord<unknown>) => Effect.Effect<void>;
    onEffectComplete: (
      record: EffectCompleteRecord<unknown, unknown, unknown>,
    ) => Effect.Effect<void>;
    onForkComplete: (
      record: ForkCompleteRecord<unknown, unknown, unknown>,
    ) => Effect.Effect<void>;
    onMaxRetries: (record: EnqueuedRecord<unknown>) => Effect.Effect<void>;
    getPending: (
      resourceId: string,
      filter?: (record: QueueRecord<unknown, unknown, unknown>) => boolean,
    ) => Effect.Effect<QueueRecord<unknown, unknown, unknown>[]>;
  };
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
    if (opts?.before && timestamp >= opts.before.getTime()) {
      return false;
    }
    if (opts?.after && timestamp <= opts.after.getTime()) {
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

const append = <T>(map: Map<string, T[]>, key: string, value: T) => {
  const current = map.get(key) ?? [];
  current.push(value);
  map.set(key, current);
};

// ============================================================================
// In-memory implementation
// ============================================================================

const makeInMemoryProcessStore = Effect.sync<ProcessStoreInterface>(() => {
  const executions = new Map<string, ExecutionRecord[]>();
  const scheduleSwitches = new Map<string, ScheduleSwitchEvent[]>();
  const lifecycleEvents = new Map<string, LifecycleEvent[]>();
  const queueRecords = new Map<string, QueueRecord<unknown, unknown, unknown>[]>();

  return {
    recordExecution: (record) =>
      Effect.sync(() => {
        append(executions, record.processId, record);
      }),

    getExecutions: (processId, opts) =>
      Effect.sync(() => {
        const rows = [...(executions.get(processId) ?? [])].sort(
          byDateDesc((row) => row.startedAt),
        );
        return applyQueryOpts(rows, opts, (row) => row.startedAt);
      }),

    recordScheduleSwitch: (event) =>
      Effect.sync(() => {
        append(scheduleSwitches, event.processId, event);
      }),

    getScheduleHistory: (processId, opts) =>
      Effect.sync(() => {
        const rows = [...(scheduleSwitches.get(processId) ?? [])].sort(
          byDateDesc((row) => row.switchedAt),
        );
        return applyQueryOpts(rows, opts, (row) => row.switchedAt);
      }),

    recordLifecycleEvent: (event) =>
      Effect.sync(() => {
        append(lifecycleEvents, event.processId, event);
      }),

    getLifecycleHistory: (processId, opts) =>
      Effect.sync(() => {
        const rows = [...(lifecycleEvents.get(processId) ?? [])].sort(
          byDateDesc((row) => row.occurredAt),
        );
        return applyQueryOpts(rows, opts, (row) => row.occurredAt);
      }),

    pool: {
      onEnqueued: (record) =>
        Effect.sync(() => {
          append(queueRecords, record.resourceId, record);
        }),

      onEffectComplete: (record) =>
        Effect.sync(() => {
          append(queueRecords, record.resourceId, record);
        }),

      onForkComplete: (record) =>
        Effect.sync(() => {
          append(queueRecords, record.resourceId, record);
        }),

      onMaxRetries: (record) =>
        Effect.sync(() => {
          append(queueRecords, record.resourceId, record);
        }),

      getPending: (resourceId, filter) =>
        Effect.sync(() => {
          const rows = [...(queueRecords.get(resourceId) ?? [])];
          if (filter === undefined) {
            return rows;
          }
          return rows.filter(filter);
        }),
    },
  };
});

// ============================================================================
// Public Service
// ============================================================================

export class ProcessStore extends Context.Service<
  ProcessStore,
  ProcessStoreInterface
>()("ProcessStore", {
  make: makeInMemoryProcessStore,
}) {}

export namespace ProcessStore {
  export const layer = Layer.effect(ProcessStore, makeInMemoryProcessStore);
  export const memory = makeInMemoryProcessStore;
}


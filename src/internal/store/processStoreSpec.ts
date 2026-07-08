/**
 * Built-in {@link Process} store contracts — three tiers (golden queue pattern).
 *
 * Tier 1 — lean base (`record` / `events`). Tier 2 — engine write-extension (narrow semantic
 * writes). Tier 3 — analytics read-extension on {@link Process.store}.
 *
 * @module internal/store/processStoreSpec
 * @internal
 */

import { Effect, Option, Schema, Stream } from "effect";
import {
  makeProcessExecutionEvent,
  processEventReadPayload,
  processExecutionEventVoid,
  type ProcessExecutionEventVoid,
} from "../processEvent";
import { errorOf, successOf } from "../processTagSchemas";
import * as Store from "../../Store";
import type {
  StoreContractValue,
  StoreShapeDef,
} from "./contractDef";
import type { StoreJournalDecodeError, StoreWriteError } from "./errors";
import type { StoreScopeTag } from "./registration";

/** @internal */
type ProcessWireSchemas = {
  readonly success?: Schema.Top;
  readonly error?: Schema.Top;
};

/** Read `success` / `error` wire slots off a process tag. @internal */
const processWireFromTag = (tag: StoreScopeTag): ProcessWireSchemas => ({
  success: successOf(tag),
  error: errorOf(tag),
});

const processEventSchema = (
  success?: Schema.Top,
  error?: Schema.Top,
) =>
  success === undefined && error === undefined
    ? processExecutionEventVoid
    : makeProcessExecutionEvent(success, error);

/**
 * The persisted process event **schema** for a tag — kept **erased** at the schema level (the void
 * union from {@link processExecutionEventVoid}); typed success/error ride at the decoded level on
 * analytics reads. @internal
 */
export type ProcessEventSchemaOf<_Tag extends StoreScopeTag> = typeof processExecutionEventVoid;

/**
 * The persisted process event for a tag — the base `record` / `events` surface stays **erased**
 * (`success?: unknown`, `error: unknown`). @internal
 */
export type ProcessEventOf<_Tag extends StoreScopeTag> =
  | Extract<ProcessExecutionEventVoid, { readonly _tag: "RunStarted" }>
  | (Extract<ProcessExecutionEventVoid, { readonly _tag: "RunCompleted" }> & {
    readonly success?: unknown;
  })
  | (Omit<Extract<ProcessExecutionEventVoid, { readonly _tag: "RunFailed" }>, "error"> & {
    readonly error: unknown;
  })
  | Extract<ProcessExecutionEventVoid, { readonly _tag: "RunInterrupted" }>;

/** Event union schema for a process store contract. @internal */
export const processStoreEventSchema = processEventSchema;

/** Decoded persisted event for a tag. @internal */
export type ProcessStoreEvent<Tag extends StoreScopeTag = StoreScopeTag> = ProcessEventOf<Tag>;

/** @internal */
export type ProcessStoreFailed<Tag extends StoreScopeTag> = Extract<
  ProcessStoreEvent<Tag>,
  { readonly _tag: "RunFailed" }
>;

/** @internal */
export type ProcessStoreCompleted<Tag extends StoreScopeTag> = Extract<
  ProcessStoreEvent<Tag>,
  { readonly _tag: "RunCompleted" }
>;

/** @internal */
export type ProcessStoreStarted<Tag extends StoreScopeTag> = Extract<
  ProcessStoreEvent<Tag>,
  { readonly _tag: "RunStarted" }
>;

/** Lifetime execution counts. @internal */
export interface ProcessStoreStats {
  readonly started: number;
  readonly completed: number;
  readonly failed: number;
  readonly interrupted: number;
}

/** Duration distribution over completions (`durationMs`). @internal */
export interface ProcessStoreDurationStats {
  readonly meanMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly maxMs: number;
}

/** Analytics reads on {@link Process.store}. @internal */
export type ProcessStoreReads<Tag extends StoreScopeTag> = {
  readonly failures: () => Effect.Effect<ReadonlyArray<ProcessStoreFailed<Tag>>>;
  readonly completions: () => Effect.Effect<ReadonlyArray<ProcessStoreCompleted<Tag>>>;
  readonly interruptions: () => Effect.Effect<ReadonlyArray<ProcessStoreEvent<Tag>>>;
  readonly inFlight: () => Effect.Effect<ReadonlyArray<ProcessStoreStarted<Tag>>>;
  readonly lastFailure: () => Effect.Effect<Option.Option<ProcessStoreFailed<Tag>>>;
  readonly lastCompletion: () => Effect.Effect<Option.Option<ProcessStoreCompleted<Tag>>>;
  readonly recent: (n: number) => Effect.Effect<ReadonlyArray<ProcessStoreEvent<Tag>>>;
  readonly stats: () => Effect.Effect<ProcessStoreStats>;
  readonly failureRate: () => Effect.Effect<number>;
  readonly durationStats: () => Effect.Effect<ProcessStoreDurationStats>;
  readonly bySchedule: (
    scheduleKey: string | null,
  ) => Effect.Effect<ReadonlyArray<ProcessStoreEvent<Tag>>>;
  readonly startupRuns: () => Effect.Effect<ReadonlyArray<ProcessStoreEvent<Tag>>>;
  readonly longestRuns: (
    n: number,
  ) => Effect.Effect<ReadonlyArray<ProcessStoreCompleted<Tag>>>;
  /** Live decoded event stream (via {@link Store.changes}). */
  readonly changes: () => Stream.Stream<
    ProcessStoreEvent<Tag>,
    StoreJournalDecodeError,
    Store.Storage
  >;
};

const percentile = (sorted: ReadonlyArray<number>, p: number): number => {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))]!;
};

const runKey = (startedAt: number, scheduleKey: string | null): string =>
  `${String(startedAt)}:${scheduleKey ?? ""}`;

// ============================================================================
// Tier 1 — lean base
// ============================================================================

/** Built-in process store contract — one `event` shape. @internal */
export type BuiltInProcessContract<Tag extends StoreScopeTag> = StoreContractValue<
  {
    readonly event: StoreShapeDef<
      ProcessEventSchemaOf<Tag>,
      typeof processEventReadPayload
    >;
  },
  {
    readonly record: (
      event: ProcessStoreEvent<Tag>,
    ) => Effect.Effect<void, StoreWriteError>;
    readonly events: (
      payload?: { readonly limit?: number },
    ) => Effect.Effect<ReadonlyArray<ProcessStoreEvent<Tag>>>;
    readonly hasPriorExecutions: () => Effect.Effect<boolean>;
  }
>;

/** Build the process store contract (optional success / error schemas). @internal */
export const makeProcessStoreContract = (
  success?: Schema.Top,
  error?: Schema.Top,
) =>
  Store.contract(
    {
      event: Store.shape(processEventSchema(success, error), processEventReadPayload),
    },
    ({ event }) => ({
      record: event.append,
      events: event.read,
      hasPriorExecutions: () =>
        Effect.map(event.read({ limit: 1 }), (rows) => rows.length > 0),
    }),
  );

/** Built-in process store contract for a tag. @internal */
export const builtInProcessStoreContract = <const Tag extends StoreScopeTag>(
  tag: Tag,
): BuiltInProcessContract<Tag> =>
  makeProcessStoreContract(successOf(tag), errorOf(tag)) as BuiltInProcessContract<Tag>;

// ============================================================================
// Tier 2 — engine write-extension
// ============================================================================

/** Narrow write inputs — engine supplies `processId` when building rows. @internal */
export type ProcessStoreStartedInput = {
  readonly scheduleKey: string | null;
  readonly startedAt: number;
  readonly isStartupRun: boolean;
};

/** @internal */
export type ProcessStoreTerminalInput = {
  readonly scheduleKey: string | null;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly isStartupRun: boolean;
};

/**
 * Build the engine write-extension from wire schemas + scope key.
 * @internal
 */
export const makeEngineProcessStoreContract = (
  processId: string,
  wire?: ProcessWireSchemas,
) => {
  const eventSchema = processEventSchema(wire?.success, wire?.error);

  const terminalRow = (input: ProcessStoreTerminalInput) => ({
    processId,
    scheduleKey: input.scheduleKey,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    durationMs: input.completedAt - input.startedAt,
    isStartupRun: input.isStartupRun,
  });

  return Store.contract(
    {
      event: Store.shape(eventSchema, processEventReadPayload),
    },
    ({ event }) => ({
      record: event.append,
      events: event.read,
      hasPriorExecutions: () =>
        Effect.map(event.read({ limit: 1 }), (rows) => rows.length > 0),
      recordStarted: (input: ProcessStoreStartedInput) =>
        event.append({
          _tag: "RunStarted",
          processId,
          scheduleKey: input.scheduleKey,
          startedAt: input.startedAt,
          isStartupRun: input.isStartupRun,
        }),
      recordCompleted: (
        input: ProcessStoreTerminalInput & { readonly success?: unknown },
      ) =>
        event.append({
          _tag: "RunCompleted",
          ...terminalRow(input),
          ...(input.success !== undefined ? { success: input.success } : {}),
        }),
      recordFailed: (
        input: ProcessStoreTerminalInput & { readonly error: unknown },
      ) =>
        event.append({
          _tag: "RunFailed",
          ...terminalRow(input),
          error: input.error,
        }),
      recordInterrupted: (input: ProcessStoreTerminalInput) =>
        event.append({
          _tag: "RunInterrupted",
          ...terminalRow(input),
        }),
    }),
  );
};

/** Engine write-extension for a tag. @internal */
export const engineProcessStoreContract = (tag: StoreScopeTag) =>
  makeEngineProcessStoreContract(tag.key, processWireFromTag(tag));

/** @internal */
export type EngineProcessStoreContract = ReturnType<typeof engineProcessStoreContract>;

// ============================================================================
// Tier 3 — analytics read-extension
// ============================================================================

/** Build analytics contract for {@link Process.store}. @internal */
export const makeProcessStoreAnalyticsContract = <const Tag extends StoreScopeTag>(
  tag: Tag,
) => {
  const base = builtInProcessStoreContract(tag);
  const storeClass = { scopeKey: tag.key, contract: base };
  const wire = processWireFromTag(tag);
  const rowSchema = processEventSchema(wire.success, wire.error);
  type EventRow = (typeof rowSchema)["Type"];

  const isFailed = (event: EventRow): event is ProcessStoreFailed<Tag> =>
    event._tag === "RunFailed";

  const isCompleted = (event: EventRow): event is ProcessStoreCompleted<Tag> =>
    event._tag === "RunCompleted";

  const isStarted = (event: EventRow): event is ProcessStoreStarted<Tag> =>
    event._tag === "RunStarted";

  const isTerminal = (event: EventRow): boolean =>
    event._tag === "RunCompleted" ||
    event._tag === "RunFailed" ||
    event._tag === "RunInterrupted";

  return Store.contract(
    {
      event: Store.shape(rowSchema, processEventReadPayload),
    },
    ({ event }) => ({
      record: event.append,
      events: event.read,
      hasPriorExecutions: () =>
        Effect.map(event.read({ limit: 1 }), (rows) => rows.length > 0),
      failures: (): Effect.Effect<ReadonlyArray<ProcessStoreFailed<Tag>>> =>
        Effect.map(event.read(), (events) => events.filter(isFailed)),
      completions: (): Effect.Effect<ReadonlyArray<ProcessStoreCompleted<Tag>>> =>
        Effect.map(event.read(), (events) => events.filter(isCompleted)),
      interruptions: (): Effect.Effect<ReadonlyArray<EventRow>> =>
        Effect.map(event.read(), (events) =>
          events.filter((e) => e._tag === "RunInterrupted"),
        ),
      inFlight: (): Effect.Effect<ReadonlyArray<ProcessStoreStarted<Tag>>> =>
        Effect.map(event.read(), (events) => {
          const terminated = new Set<string>();
          for (const e of events) {
            if (isTerminal(e)) {
              terminated.add(runKey(e.startedAt, e.scheduleKey));
            }
          }
          return events.filter(
            (e): e is ProcessStoreStarted<Tag> =>
              isStarted(e) &&
              !terminated.has(runKey(e.startedAt, e.scheduleKey)),
          );
        }),
      lastFailure: (): Effect.Effect<Option.Option<ProcessStoreFailed<Tag>>> =>
        Effect.map(event.read(), (events) => {
          const failures = events.filter(isFailed);
          return failures.length === 0
            ? Option.none()
            : Option.some(failures[failures.length - 1]!);
        }),
      lastCompletion: (): Effect.Effect<Option.Option<ProcessStoreCompleted<Tag>>> =>
        Effect.map(event.read(), (events) => {
          const completions = events.filter(isCompleted);
          return completions.length === 0
            ? Option.none()
            : Option.some(completions[completions.length - 1]!);
        }),
      recent: (n: number): Effect.Effect<ReadonlyArray<EventRow>> =>
        Effect.map(event.read(), (events) =>
          n <= 0 ? [] : events.slice(Math.max(0, events.length - n)),
        ),
      stats: (): Effect.Effect<ProcessStoreStats> =>
        Effect.map(event.read(), (events) => {
          let started = 0;
          let completed = 0;
          let failed = 0;
          let interrupted = 0;
          for (const e of events) {
            switch (e._tag) {
              case "RunStarted":
                started += 1;
                break;
              case "RunCompleted":
                completed += 1;
                break;
              case "RunFailed":
                failed += 1;
                break;
              case "RunInterrupted":
                interrupted += 1;
                break;
              default:
                break;
            }
          }
          return { started, completed, failed, interrupted };
        }),
      failureRate: (): Effect.Effect<number> =>
        Effect.map(event.read(), (events) => {
          let completed = 0;
          let failed = 0;
          for (const e of events) {
            if (e._tag === "RunCompleted") completed += 1;
            else if (e._tag === "RunFailed") failed += 1;
          }
          const total = completed + failed;
          return total === 0 ? 0 : failed / total;
        }),
      durationStats: (): Effect.Effect<ProcessStoreDurationStats> =>
        Effect.map(event.read(), (events) => {
          const durations = events
            .filter(isCompleted)
            .map((e) => e.durationMs);
          if (durations.length === 0) {
            return { meanMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0 };
          }
          const sorted = [...durations].sort((a, b) => a - b);
          const mean = durations.reduce((a, b) => a + b, 0) / durations.length;
          return {
            meanMs: mean,
            p50Ms: percentile(sorted, 50),
            p95Ms: percentile(sorted, 95),
            p99Ms: percentile(sorted, 99),
            maxMs: sorted[sorted.length - 1]!,
          };
        }),
      bySchedule: (
        scheduleKey: string | null,
      ): Effect.Effect<ReadonlyArray<EventRow>> =>
        Effect.map(event.read(), (events) =>
          events.filter((e) => e.scheduleKey === scheduleKey),
        ),
      startupRuns: (): Effect.Effect<ReadonlyArray<EventRow>> =>
        Effect.map(event.read(), (events) =>
          events.filter((e) => e.isStartupRun),
        ),
      longestRuns: (
        n: number,
      ): Effect.Effect<ReadonlyArray<ProcessStoreCompleted<Tag>>> =>
        Effect.map(event.read(), (events) =>
          [...events.filter(isCompleted)]
            .sort((a, b) => b.durationMs - a.durationMs)
            .slice(0, Math.max(0, n)),
        ),
      changes: (): Stream.Stream<
        ProcessStoreEvent<Tag>,
        StoreJournalDecodeError,
        Store.Storage
      > => Stream.unwrap(Store.changes(storeClass, (shapes) => shapes.event)),
    }),
  );
};

/** Analytics contract type for {@link Process.store}. @internal */
export type ProcessStoreAnalyticsContract<Tag extends StoreScopeTag> = ReturnType<
  typeof makeProcessStoreAnalyticsContract<Tag>
>;

/** @deprecated Use {@link ProcessStoreEvent}. @internal */
export type ProcessStoreEventRow = ProcessStoreEvent;

/** @deprecated Internal flat spec — use {@link builtInProcessStoreContract}. @internal */
export const builtInProcessStoreSpec = (tag: StoreScopeTag) =>
  builtInProcessStoreContract(tag).spec;

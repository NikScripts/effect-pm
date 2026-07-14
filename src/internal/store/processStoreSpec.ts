/**
 * Built-in {@link Process} store contract.
 *
 * Two tiers (mirrors {@link RunResource} / {@link QueueResource}):
 * - **Tier 1** — lean base (`builtInProcessStoreContract`)
 * - **Tier 2** — analytics read-extension (`makeProcessStoreAnalyticsContract`)
 *
 * Tier 2 composes tier 1 via {@link Store.extend} — shapes stay on tier 1;
 * the extension only adds analytics read methods. The engine writes via shape
 * `event.append` directly (`store.record`).
 *
 * @module internal/store/processStoreSpec
 * @internal
 */

import { Effect, Option, Schema, Stream } from "effect";
import {
  makeProcessExecutionEvent,
  processExecutionEventVoid,
  type ProcessExecutionEventVoid,
} from "../processEvent";
import { errorOf, successOf } from "../processTagSchemas";
import * as Store from "../../Store";
import type {
  StoreContractValue,
  StoreShapeDef,
} from "./contractDef";
import type { ShapeHandles } from "./contractDef";
import type { StoreJournalDecodeError, StoreWriteError } from "./errors";
import { withImplicitLogShape } from "./logShapes";
import type { StoreScopeTag } from "./registration";

const processEventSchema = (
  success?: Schema.Top,
  error?: Schema.Top,
) =>
  success === undefined && error === undefined
    ? processExecutionEventVoid
    : makeProcessExecutionEvent(success, error);

/**
 * Erased persisted event **schema** for contract typing — `success` / `error` wire slots are
 * `Schema.Top` here (mirrors {@link QueueEventSchemaOf}). Runtime validation uses the tag's wire
 * slots in {@link makeProcessStoreBaseContract}; decoded rows use {@link ProcessEventOf}.
 * @internal
 */
export type ProcessEventSchemaOf<_Tag extends StoreScopeTag> = ReturnType<
  typeof makeProcessExecutionEvent<Schema.Top, Schema.Top>
>;

/**
 * The persisted process event for a tag — the base `record` / `events` surface stays **erased**
 * (`success?: unknown`, `error: unknown`). @internal
 */
export type ProcessEventOf<_Tag extends StoreScopeTag> =
  | Extract<ProcessExecutionEventVoid, { readonly _tag: "Started" }>
  | (Extract<ProcessExecutionEventVoid, { readonly _tag: "Completed" }> & {
    readonly success?: unknown;
  })
  | (Omit<Extract<ProcessExecutionEventVoid, { readonly _tag: "Failed" }>, "error"> & {
    readonly error: unknown;
  })
  | Extract<ProcessExecutionEventVoid, { readonly _tag: "Interrupted" }>;

/** Event union schema for a process store contract. @internal */
export const processStoreEventSchema = processEventSchema;

/** Decoded persisted event for a tag. @internal */
export type ProcessStoreEvent<Tag extends StoreScopeTag = StoreScopeTag> = ProcessEventOf<Tag>;

/** @internal */
export type ProcessStoreFailed<Tag extends StoreScopeTag> = Extract<
  ProcessStoreEvent<Tag>,
  { readonly _tag: "Failed" }
>;

/** @internal */
export type ProcessStoreCompleted<Tag extends StoreScopeTag> = Extract<
  ProcessStoreEvent<Tag>,
  { readonly _tag: "Completed" }
>;

/** @internal */
export type ProcessStoreStarted<Tag extends StoreScopeTag> = Extract<
  ProcessStoreEvent<Tag>,
  { readonly _tag: "Started" }
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
// Base — shared event shape + append/read aliases (internal + public SSOT)
// ============================================================================

type ProcessEventHandles = ShapeHandles<{
  readonly event: ReturnType<typeof Store.shape<ReturnType<typeof processEventSchema>>>;
}>;

/** Shared base methods — extensions close over the same `event.append` / `event.read`. @internal */
const processStoreBaseMethods = ({ event }: ProcessEventHandles) => ({
  record: event.append,
  events: event.read,
  hasPriorExecutions: () =>
    Effect.map(event.read({ limit: 1 }), (rows) => rows.length > 0),
});

/** Built-in process store contract for a tag — one `event` shape (mirrors {@link BuiltInQueueContract}). @internal */
export type BuiltInProcessContract<Tag extends StoreScopeTag> = StoreContractValue<
  {
    readonly event: StoreShapeDef<ProcessEventSchemaOf<Tag>>;
  },
  {
    readonly record: (
      event: ProcessStoreEvent<Tag>,
    ) => Effect.Effect<void, StoreWriteError>;
    readonly events: (
      payload?: Store.StoreReadPayload<ProcessStoreEvent<Tag>>,
    ) => Effect.Effect<ReadonlyArray<ProcessStoreEvent<Tag>>>;
    readonly hasPriorExecutions: () => Effect.Effect<boolean>;
  }
>;

/** @deprecated Use {@link BuiltInProcessContract}. @internal */
export type ProcessStoreBaseContract<Tag extends StoreScopeTag> = BuiltInProcessContract<Tag>;

/**
 * Build the shared base contract (optional success / error schemas on the event union).
 * @internal
 */
export const makeProcessStoreBaseContract = (
  success?: Schema.Top,
  error?: Schema.Top,
) =>
  Store.contract(
    {
      event: Store.shape(processEventSchema(success, error)),
    },
    processStoreBaseMethods,
  );

/** Built-in process store contract for a tag (tier-1 / engine / tests / simple registration). @internal */
export const builtInProcessStoreContract = <const Tag extends StoreScopeTag>(
  tag: Tag,
): BuiltInProcessContract<Tag> =>
  makeProcessStoreBaseContract(successOf(tag), errorOf(tag));

/** Narrow write inputs — engine supplies resource `key` when building rows. @internal */
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

// ============================================================================
// Public — analytics read-extension (derivations over shared event.read)
// ============================================================================

/** Build the public analytics contract — base + read derivations. @internal */
export const makeProcessStoreAnalyticsContract = <const Tag extends StoreScopeTag>(
  tag: Tag,
) => {
  const base = builtInProcessStoreContract(tag);
  const storeClass = { scopeKey: tag.key, contract: base };
  const isFailed = (event: ProcessStoreEvent<Tag>): event is ProcessStoreFailed<Tag> =>
    event._tag === "Failed";

  const isCompleted = (event: ProcessStoreEvent<Tag>): event is ProcessStoreCompleted<Tag> =>
    event._tag === "Completed";

  const isStarted = (event: ProcessStoreEvent<Tag>): event is ProcessStoreStarted<Tag> =>
    event._tag === "Started";

  const isTerminal = (event: ProcessStoreEvent<Tag>): boolean =>
    event._tag === "Completed" ||
    event._tag === "Failed" ||
    event._tag === "Interrupted";

  return withImplicitLogShape(
    Store.extend(
      ({ event }) => ({
        failures: (): Effect.Effect<ReadonlyArray<ProcessStoreFailed<Tag>>> =>
          Effect.map(event.read(), (events) =>
            (events as ReadonlyArray<ProcessStoreEvent<Tag>>).filter(isFailed),
          ),
        completions: (): Effect.Effect<ReadonlyArray<ProcessStoreCompleted<Tag>>> =>
          Effect.map(event.read(), (events) => events.filter(isCompleted)),
        interruptions: (): Effect.Effect<ReadonlyArray<ProcessStoreEvent<Tag>>> =>
          Effect.map(event.read(), (events) =>
            (events as ReadonlyArray<ProcessStoreEvent<Tag>>).filter(
              (e) => e._tag === "Interrupted",
            ),
          ),
        inFlight: (): Effect.Effect<ReadonlyArray<ProcessStoreStarted<Tag>>> =>
          Effect.map(event.read(), (events) => {
            const rows = events as ReadonlyArray<ProcessStoreEvent<Tag>>;
            const terminated = new Set<string>();
            for (const e of rows) {
              if (isTerminal(e)) {
                terminated.add(runKey(e.startedAt, e.scheduleKey));
              }
            }
            return rows.filter(
              (e): e is ProcessStoreStarted<Tag> =>
                isStarted(e) &&
                !terminated.has(runKey(e.startedAt, e.scheduleKey)),
            );
          }),
        lastFailure: (): Effect.Effect<Option.Option<ProcessStoreFailed<Tag>>> =>
          Effect.map(event.read(), (events) => {
            const failures = (events as ReadonlyArray<ProcessStoreEvent<Tag>>).filter(isFailed);
            return failures.length === 0
              ? Option.none()
              : Option.some(failures[failures.length - 1]!);
          }),
        lastCompletion: (): Effect.Effect<Option.Option<ProcessStoreCompleted<Tag>>> =>
          Effect.map(event.read(), (events) => {
            const completions = (events as ReadonlyArray<ProcessStoreEvent<Tag>>).filter(isCompleted);
            return completions.length === 0
              ? Option.none()
              : Option.some(completions[completions.length - 1]!);
          }),
        recent: (n: number): Effect.Effect<ReadonlyArray<ProcessStoreEvent<Tag>>> =>
          Effect.map(event.read(), (events) => {
            const rows = events as ReadonlyArray<ProcessStoreEvent<Tag>>;
            return n <= 0 ? [] : rows.slice(Math.max(0, rows.length - n));
          }),
        stats: (): Effect.Effect<ProcessStoreStats> =>
          Effect.map(event.read(), (events) => {
            const rows = events as ReadonlyArray<ProcessStoreEvent<Tag>>;
            let started = 0;
            let completed = 0;
            let failed = 0;
            let interrupted = 0;
            for (const e of rows) {
              switch (e._tag) {
                case "Started":
                  started += 1;
                  break;
                case "Completed":
                  completed += 1;
                  break;
                case "Failed":
                  failed += 1;
                  break;
                case "Interrupted":
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
            const rows = events as ReadonlyArray<ProcessStoreEvent<Tag>>;
            let completed = 0;
            let failed = 0;
            for (const e of rows) {
              if (e._tag === "Completed") completed += 1;
              else if (e._tag === "Failed") failed += 1;
            }
            const total = completed + failed;
            return total === 0 ? 0 : failed / total;
          }),
        durationStats: (): Effect.Effect<ProcessStoreDurationStats> =>
          Effect.map(event.read(), (events) => {
            const durations = (events as ReadonlyArray<ProcessStoreEvent<Tag>>)
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
        ): Effect.Effect<ReadonlyArray<ProcessStoreEvent<Tag>>> =>
          Effect.map(event.read(), (events) =>
            (events as ReadonlyArray<ProcessStoreEvent<Tag>>).filter(
              (e) => e.scheduleKey === scheduleKey,
            ),
          ),
        startupRuns: (): Effect.Effect<ReadonlyArray<ProcessStoreEvent<Tag>>> =>
          Effect.map(event.read(), (events) =>
            (events as ReadonlyArray<ProcessStoreEvent<Tag>>).filter((e) => e.isStartupRun),
          ),
        longestRuns: (
          n: number,
        ): Effect.Effect<ReadonlyArray<ProcessStoreCompleted<Tag>>> =>
          Effect.map(event.read(), (events) =>
            [...(events as ReadonlyArray<ProcessStoreEvent<Tag>>).filter(isCompleted)]
              .sort((a, b) => b.durationMs - a.durationMs)
              .slice(0, Math.max(0, n)),
          ),
        changes: (): Stream.Stream<
          ProcessStoreEvent<Tag>,
          StoreJournalDecodeError,
          Store.Storage
        > => Stream.unwrap(Store.changes(storeClass, (shapes) => shapes.event)),
      }),
      base,
    ),
  );
};

/** Public analytics contract type for {@link Process.store}. @internal */
export type ProcessStoreAnalyticsContract<Tag extends StoreScopeTag> = ReturnType<
  typeof makeProcessStoreAnalyticsContract<Tag>
>;

/** @deprecated Use {@link ProcessStoreEvent}. @internal */
export type ProcessStoreEventRow = ProcessStoreEvent;

/** @deprecated Internal flat spec — use {@link builtInProcessStoreContract}. @internal */
export const builtInProcessStoreSpec = (tag: StoreScopeTag) =>
  builtInProcessStoreContract(tag).spec;

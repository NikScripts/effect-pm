/**
 * Built-in {@link Daemon} store contract.
 *
 * Two tiers (mirrors {@link Gate} / {@link WorkPool}):
 * - **Tier 1** — lean base (`builtInDaemonStoreContract`)
 * - **Tier 2** — analytics read-extension (`makeDaemonStoreAnalyticsContract`)
 *
 * Tier 2 composes tier 1 via {@link Store.extend} — shapes stay on tier 1;
 * the extension only adds analytics read methods. The engine writes via shape
 * `event.append` directly (`store.record`).
 *
 * @module internal/store/daemonStoreSpec
 * @internal
 */

import { Effect, Option, Schema, Stream } from "effect";
import {
  makeDaemonExecutionEvent,
  daemonExecutionEventVoid,
  type DaemonExecutionEventVoid,
} from "../daemonEvent";
import { errorOf, successOf } from "../daemonTagSchemas";
import * as Store from "../../Store";
import type {
  StoreContractValue,
  StoreShapeDef,
} from "./contractDef";
import type { ShapeHandles } from "./contractDef";
import type { StoreJournalDecodeError, StoreWriteError } from "./errors";
import { withImplicitLogShape } from "./logShapes";
import type { StoreScopeTag } from "./registration";

const daemonEventSchema = (
  success?: Schema.Top,
  error?: Schema.Top,
) =>
  success === undefined && error === undefined
    ? daemonExecutionEventVoid
    : makeDaemonExecutionEvent(success, error);

/**
 * Erased persisted event **schema** for contract typing — `success` / `error` wire slots are
 * `Schema.Top` here (mirrors {@link QueueEventSchemaOf}). Runtime validation uses the tag's wire
 * slots in {@link makeDaemonStoreBaseContract}; decoded rows use {@link DaemonEventOf}.
 * @internal
 */
export type DaemonEventSchemaOf<_Tag extends StoreScopeTag> = ReturnType<
  typeof makeDaemonExecutionEvent<Schema.Top, Schema.Top>
>;

/**
 * The persisted daemon event for a tag — the base `record` / `events` surface stays **erased**
 * (`success?: unknown`, `error: unknown`). @internal
 */
export type DaemonEventOf<_Tag extends StoreScopeTag> =
  | Extract<DaemonExecutionEventVoid, { readonly _tag: "Started" }>
  | (Extract<DaemonExecutionEventVoid, { readonly _tag: "Completed" }> & {
    readonly success?: unknown;
  })
  | (Omit<Extract<DaemonExecutionEventVoid, { readonly _tag: "Failed" }>, "error"> & {
    readonly error: unknown;
  })
  | Extract<DaemonExecutionEventVoid, { readonly _tag: "Interrupted" }>;

/** Event union schema for a daemon store contract. @internal */
export const daemonStoreEventSchema = daemonEventSchema;

/** Decoded persisted event for a tag. @internal */
export type DaemonStoreEvent<Tag extends StoreScopeTag = StoreScopeTag> = DaemonEventOf<Tag>;

/** @internal */
export type DaemonStoreFailed<Tag extends StoreScopeTag> = Extract<
  DaemonStoreEvent<Tag>,
  { readonly _tag: "Failed" }
>;

/** @internal */
export type DaemonStoreCompleted<Tag extends StoreScopeTag> = Extract<
  DaemonStoreEvent<Tag>,
  { readonly _tag: "Completed" }
>;

/** @internal */
export type DaemonStoreStarted<Tag extends StoreScopeTag> = Extract<
  DaemonStoreEvent<Tag>,
  { readonly _tag: "Started" }
>;

/** Lifetime execution counts. @internal */
export interface DaemonStoreStats {
  readonly started: number;
  readonly completed: number;
  readonly failed: number;
  readonly interrupted: number;
}

/** Duration distribution over completions (`durationMs`). @internal */
export interface DaemonStoreDurationStats {
  readonly meanMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly maxMs: number;
}

/** Analytics reads on {@link Daemon.store}. @internal */
export type DaemonStoreReads<Tag extends StoreScopeTag> = {
  readonly failures: () => Effect.Effect<ReadonlyArray<DaemonStoreFailed<Tag>>>;
  readonly completions: () => Effect.Effect<ReadonlyArray<DaemonStoreCompleted<Tag>>>;
  readonly interruptions: () => Effect.Effect<ReadonlyArray<DaemonStoreEvent<Tag>>>;
  readonly inFlight: () => Effect.Effect<ReadonlyArray<DaemonStoreStarted<Tag>>>;
  readonly lastFailure: () => Effect.Effect<Option.Option<DaemonStoreFailed<Tag>>>;
  readonly lastCompletion: () => Effect.Effect<Option.Option<DaemonStoreCompleted<Tag>>>;
  readonly recent: (n: number) => Effect.Effect<ReadonlyArray<DaemonStoreEvent<Tag>>>;
  readonly stats: () => Effect.Effect<DaemonStoreStats>;
  readonly failureRate: () => Effect.Effect<number>;
  readonly durationStats: () => Effect.Effect<DaemonStoreDurationStats>;
  readonly bySchedule: (
    scheduleKey: string | null,
  ) => Effect.Effect<ReadonlyArray<DaemonStoreEvent<Tag>>>;
  readonly startupRuns: () => Effect.Effect<ReadonlyArray<DaemonStoreEvent<Tag>>>;
  readonly longestRuns: (
    n: number,
  ) => Effect.Effect<ReadonlyArray<DaemonStoreCompleted<Tag>>>;
  /** Live decoded event stream (via {@link Store.changes}). */
  readonly changes: () => Stream.Stream<
    DaemonStoreEvent<Tag>,
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

type DaemonEventHandles = ShapeHandles<{
  readonly event: ReturnType<typeof Store.shape<ReturnType<typeof daemonEventSchema>>>;
}>;

/** Shared base methods — extensions close over the same `event.append` / `event.read`. @internal */
const daemonStoreBaseMethods = ({ event }: DaemonEventHandles) => ({
  record: event.append,
  events: event.read,
  hasPriorExecutions: () =>
    Effect.map(event.read({ limit: 1 }), (rows) => rows.length > 0),
});

/** Built-in daemon store contract for a tag — one `event` shape (mirrors {@link BuiltInQueueContract}). @internal */
export type BuiltInDaemonContract<Tag extends StoreScopeTag> = StoreContractValue<
  {
    readonly event: StoreShapeDef<DaemonEventSchemaOf<Tag>>;
  },
  {
    readonly record: (
      event: DaemonStoreEvent<Tag>,
    ) => Effect.Effect<void, StoreWriteError>;
    readonly events: (
      payload?: Store.StoreReadPayload<DaemonStoreEvent<Tag>>,
    ) => Effect.Effect<ReadonlyArray<DaemonStoreEvent<Tag>>>;
    readonly hasPriorExecutions: () => Effect.Effect<boolean>;
  }
>;

/** @deprecated Use {@link BuiltInDaemonContract}. @internal */
export type DaemonStoreBaseContract<Tag extends StoreScopeTag> = BuiltInDaemonContract<Tag>;

/**
 * Build the shared base contract (optional success / error schemas on the event union).
 * @internal
 */
export const makeDaemonStoreBaseContract = (
  success?: Schema.Top,
  error?: Schema.Top,
) =>
  Store.contract(
    {
      event: Store.shape(daemonEventSchema(success, error)),
    },
    daemonStoreBaseMethods,
  );

/** Built-in daemon store contract for a tag (tier-1 / engine / tests / simple registration). @internal */
export const builtInDaemonStoreContract = <const Tag extends StoreScopeTag>(
  tag: Tag,
): BuiltInDaemonContract<Tag> =>
  makeDaemonStoreBaseContract(successOf(tag), errorOf(tag));

/** Narrow write inputs — engine supplies resource `key` when building rows. @internal */
export type DaemonStoreStartedInput = {
  readonly scheduleKey: string | null;
  readonly startedAt: number;
  readonly isStartupRun: boolean;
};

/** @internal */
export type DaemonStoreTerminalInput = {
  readonly scheduleKey: string | null;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly isStartupRun: boolean;
};

// ============================================================================
// Public — analytics read-extension (derivations over shared event.read)
// ============================================================================

/** Build the public analytics contract — base + read derivations. @internal */
export const makeDaemonStoreAnalyticsContract = <const Tag extends StoreScopeTag>(
  tag: Tag,
) => {
  const base = builtInDaemonStoreContract(tag);
  const storeClass = { scopeKey: tag.key, contract: base };
  const isFailed = (event: DaemonStoreEvent<Tag>): event is DaemonStoreFailed<Tag> =>
    event._tag === "Failed";

  const isCompleted = (event: DaemonStoreEvent<Tag>): event is DaemonStoreCompleted<Tag> =>
    event._tag === "Completed";

  const isStarted = (event: DaemonStoreEvent<Tag>): event is DaemonStoreStarted<Tag> =>
    event._tag === "Started";

  const isTerminal = (event: DaemonStoreEvent<Tag>): boolean =>
    event._tag === "Completed" ||
    event._tag === "Failed" ||
    event._tag === "Interrupted";

  return withImplicitLogShape(
    Store.extend(
      ({ event }) => ({
        failures: (): Effect.Effect<ReadonlyArray<DaemonStoreFailed<Tag>>> =>
          Effect.map(event.read(), (events) =>
            (events as ReadonlyArray<DaemonStoreEvent<Tag>>).filter(isFailed),
          ),
        completions: (): Effect.Effect<ReadonlyArray<DaemonStoreCompleted<Tag>>> =>
          Effect.map(event.read(), (events) => events.filter(isCompleted)),
        interruptions: (): Effect.Effect<ReadonlyArray<DaemonStoreEvent<Tag>>> =>
          Effect.map(event.read(), (events) =>
            (events as ReadonlyArray<DaemonStoreEvent<Tag>>).filter(
              (e) => e._tag === "Interrupted",
            ),
          ),
        inFlight: (): Effect.Effect<ReadonlyArray<DaemonStoreStarted<Tag>>> =>
          Effect.map(event.read(), (events) => {
            const rows = events as ReadonlyArray<DaemonStoreEvent<Tag>>;
            const terminated = new Set<string>();
            for (const e of rows) {
              if (isTerminal(e)) {
                terminated.add(runKey(e.startedAt, e.scheduleKey));
              }
            }
            return rows.filter(
              (e): e is DaemonStoreStarted<Tag> =>
                isStarted(e) &&
                !terminated.has(runKey(e.startedAt, e.scheduleKey)),
            );
          }),
        lastFailure: (): Effect.Effect<Option.Option<DaemonStoreFailed<Tag>>> =>
          Effect.map(event.read(), (events) => {
            const failures = (events as ReadonlyArray<DaemonStoreEvent<Tag>>).filter(isFailed);
            return failures.length === 0
              ? Option.none()
              : Option.some(failures[failures.length - 1]!);
          }),
        lastCompletion: (): Effect.Effect<Option.Option<DaemonStoreCompleted<Tag>>> =>
          Effect.map(event.read(), (events) => {
            const completions = (events as ReadonlyArray<DaemonStoreEvent<Tag>>).filter(isCompleted);
            return completions.length === 0
              ? Option.none()
              : Option.some(completions[completions.length - 1]!);
          }),
        recent: (n: number): Effect.Effect<ReadonlyArray<DaemonStoreEvent<Tag>>> =>
          Effect.map(event.read(), (events) => {
            const rows = events as ReadonlyArray<DaemonStoreEvent<Tag>>;
            return n <= 0 ? [] : rows.slice(Math.max(0, rows.length - n));
          }),
        stats: (): Effect.Effect<DaemonStoreStats> =>
          Effect.map(event.read(), (events) => {
            const rows = events as ReadonlyArray<DaemonStoreEvent<Tag>>;
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
            const rows = events as ReadonlyArray<DaemonStoreEvent<Tag>>;
            let completed = 0;
            let failed = 0;
            for (const e of rows) {
              if (e._tag === "Completed") completed += 1;
              else if (e._tag === "Failed") failed += 1;
            }
            const total = completed + failed;
            return total === 0 ? 0 : failed / total;
          }),
        durationStats: (): Effect.Effect<DaemonStoreDurationStats> =>
          Effect.map(event.read(), (events) => {
            const durations = (events as ReadonlyArray<DaemonStoreEvent<Tag>>)
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
        ): Effect.Effect<ReadonlyArray<DaemonStoreEvent<Tag>>> =>
          Effect.map(event.read(), (events) =>
            (events as ReadonlyArray<DaemonStoreEvent<Tag>>).filter(
              (e) => e.scheduleKey === scheduleKey,
            ),
          ),
        startupRuns: (): Effect.Effect<ReadonlyArray<DaemonStoreEvent<Tag>>> =>
          Effect.map(event.read(), (events) =>
            (events as ReadonlyArray<DaemonStoreEvent<Tag>>).filter((e) => e.isStartupRun),
          ),
        longestRuns: (
          n: number,
        ): Effect.Effect<ReadonlyArray<DaemonStoreCompleted<Tag>>> =>
          Effect.map(event.read(), (events) =>
            [...(events as ReadonlyArray<DaemonStoreEvent<Tag>>).filter(isCompleted)]
              .sort((a, b) => b.durationMs - a.durationMs)
              .slice(0, Math.max(0, n)),
          ),
        changes: (): Stream.Stream<
          DaemonStoreEvent<Tag>,
          StoreJournalDecodeError,
          Store.Storage
        > => Stream.unwrap(Store.changes(storeClass, (shapes) => shapes.event)),
      }),
      base,
    ),
  );
};

/** Public analytics contract type for {@link Daemon.store}. @internal */
export type DaemonStoreAnalyticsContract<Tag extends StoreScopeTag> = ReturnType<
  typeof makeDaemonStoreAnalyticsContract<Tag>
>;

/** @deprecated Use {@link DaemonStoreEvent}. @internal */
export type DaemonStoreEventRow = DaemonStoreEvent;

/** @deprecated Internal flat spec — use {@link builtInDaemonStoreContract}. @internal */
export const builtInDaemonStoreSpec = (tag: StoreScopeTag) =>
  builtInDaemonStoreContract(tag).spec;

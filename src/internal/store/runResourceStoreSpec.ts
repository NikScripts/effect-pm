/**
 * Built-in {@link RunResource} store contract.
 *
 * Three tiers (mirrors {@link QueueResource}):
 * - **Tier 1** — lean base (`builtInRunResourceStoreContract`)
 * - **Tier 2** — engine write-extension (`engineRunResourceStoreContract`)
 * - **Tier 3** — analytics read-extension (`makeRunResourceStoreAnalyticsContract`)
 *
 * @module internal/store/runResourceStoreSpec
 * @internal
 */

import { Effect, Option, Schema, Stream } from "effect";
import * as Store from "../../Store";
import { makeRunResourceFactEvent, runFactReadPayload } from "../runResourceEvent";
import { errorOf, successOf } from "../runTagSchemas";
import { runGateStatus } from "../runResourceSchema";
import type { StoreContractValue, StoreShapeDef } from "./contractDef";
import type { StoreJournalDecodeError, StoreWriteError } from "./errors";
import type { StoreScopeTag } from "./registration";

/** Reasons attached to run gate state transitions. @internal */
export type RunResourceStateChangeReason =
  | "run-resource.run.waiting"
  | "run-resource.run.started"
  | "run-resource.run.completed"
  | "run-resource.run.failed"
  | "run-resource.run.interrupted"
  | "run-resource.run.wait.interrupted";

/** Live gate counters persisted on state transitions. @internal */
export const runStateSchema = runGateStatus;

/** Default void run facts. @internal */
export const runFactSchema = makeRunResourceFactEvent();

/** State transition row — mirrors legacy `RunResourceStateChange`. @internal */
export const runStateChangeSchema = Schema.Struct({
  id: Schema.String,
  resourceId: Schema.String,
  changedAt: Schema.Number,
  reason: Schema.String,
  previous: Schema.NullOr(runStateSchema),
  current: runStateSchema,
});

/** Read payload for built-in `stateHistory`. @internal */
export const runStateReadPayload = Schema.Struct({
  limit: Schema.optional(Schema.Number),
});

/** Persisted run fact for the default void contract. @internal */
export type RunFact = Schema.Schema.Type<typeof runFactSchema>;

/** Persisted state transition for a tag scope. @internal */
export type RunStateChange = Schema.Schema.Type<typeof runStateChangeSchema>;

/** Decoded fact union persisted for a scope. @internal */
export type RunStoreFact<_Tag extends StoreScopeTag = StoreScopeTag> = RunFact;

/** Fact row schema for a tag scope. @internal */
export const runFactSchemaForTag = (tag: StoreScopeTag) =>
  makeRunResourceFactEvent(successOf(tag), errorOf(tag));

/** Type guard — `Started` fact row. @internal */
export const isRunStoreStarted = (
  row: { readonly _tag: string },
): row is RunStoreStarted => row._tag === "Started";

/** Type guard — `Completed` fact row. @internal */
export const isRunStoreCompleted = (
  row: { readonly _tag: string },
): row is RunStoreCompleted => row._tag === "Completed";

/** Type guard — `Failed` fact row. @internal */
export const isRunStoreFailed = (
  row: { readonly _tag: string },
): row is RunStoreFailed => row._tag === "Failed";

/** Decoded `Started` row. @internal */
export type RunStoreStarted<Tag extends StoreScopeTag = StoreScopeTag> = Extract<
  RunStoreFact<Tag>,
  { readonly _tag: "Started" }
>;

/** Decoded `Failed` row. @internal */
export type RunStoreFailed<Tag extends StoreScopeTag = StoreScopeTag> = Extract<
  RunStoreFact<Tag>,
  { readonly _tag: "Failed" }
>;

/** Decoded `Completed` row. @internal */
export type RunStoreCompleted<Tag extends StoreScopeTag = StoreScopeTag> = Extract<
  RunStoreFact<Tag>,
  { readonly _tag: "Completed" }
>;

/** Lifetime run fact counts. @internal */
export interface RunStoreStats {
  readonly started: number;
  readonly completed: number;
  readonly failed: number;
}

/** Shared write surface for tier-1 contracts. @internal */
type RunResourceStoreWrites = {
  readonly record: (fact: RunFact) => Effect.Effect<void, StoreWriteError>;
  readonly facts: (
    payload?: { readonly limit?: number; readonly runId?: string },
  ) => Effect.Effect<ReadonlyArray<RunFact>>;
  readonly recordStateChange: (change: RunStateChange) => Effect.Effect<void, StoreWriteError>;
  readonly stateHistory: (
    payload?: { readonly limit?: number },
  ) => Effect.Effect<ReadonlyArray<RunStateChange>>;
};

/** Built-in run-resource store contract (tier 1). @internal */
export type BuiltInRunResourceContract = StoreContractValue<
  {
    readonly fact: StoreShapeDef<typeof runFactSchema, typeof runFactReadPayload>;
    readonly state: StoreShapeDef<typeof runStateChangeSchema, typeof runStateReadPayload>;
  },
  RunResourceStoreWrites
>;

/** Build the run store contract (optional success / error schemas). @internal */
export const makeRunResourceStoreContract = (
  success?: Schema.Top,
  error?: Schema.Top,
): BuiltInRunResourceContract =>
  Store.contract(
    {
      fact: Store.shape(makeRunResourceFactEvent(success, error), runFactReadPayload),
      state: Store.shape(runStateChangeSchema, runStateReadPayload),
    },
    ({ fact, state }) => ({
      record: fact.append,
      facts: fact.read,
      recordStateChange: state.append,
      stateHistory: state.read,
    }),
  ) as BuiltInRunResourceContract;

/** Built-in run-resource store contract for a tag (reads `success` / `error` from tag). @internal */
export const builtInRunResourceStoreContract = (
  tag: StoreScopeTag,
): BuiltInRunResourceContract =>
  makeRunResourceStoreContract(successOf(tag), errorOf(tag));

// ============================================================================
// Tier 2 — engine write-extension (semantic writes → fact/state append)
// ============================================================================

/** Row accepted by narrow `started` / `completed` / `failed` writes. @internal */
export type RunStoreStartedInput = {
  readonly id: string;
  readonly resourceId: string;
  readonly runId: string;
  readonly occurredAt: number;
  readonly concurrency: number;
};

/** Row accepted by narrow `completed` writes. @internal */
export type RunStoreCompletedInput = {
  readonly id: string;
  readonly resourceId: string;
  readonly runId: string;
  readonly occurredAt: number;
  readonly durationMs: number;
  readonly success?: unknown;
};

/** Row accepted by narrow `failed` writes. @internal */
export type RunStoreFailedInput = {
  readonly id: string;
  readonly resourceId: string;
  readonly runId: string;
  readonly occurredAt: number;
  readonly durationMs: number;
  readonly error: unknown;
};

/** Build the engine write-extension contract. @internal */
export const makeEngineRunResourceStoreContract = (
  success?: Schema.Top,
  error?: Schema.Top,
) => {
  const factSchema = makeRunResourceFactEvent(success, error);
  type FactRow = Schema.Schema.Type<typeof factSchema>;
  return Store.contract(
    {
      fact: Store.shape(factSchema, runFactReadPayload),
      state: Store.shape(runStateChangeSchema, runStateReadPayload),
    },
    ({ fact, state }) => ({
      record: fact.append,
      facts: fact.read,
      recordStateChange: state.append,
      stateHistory: state.read,
      started: (row: RunStoreStartedInput) =>
        fact.append({ _tag: "Started", ...row } as Extract<FactRow, { readonly _tag: "Started" }>),
      completed: (row: RunStoreCompletedInput) =>
        (row.success === undefined
          ? fact.append({
              _tag: "Completed",
              id: row.id,
              resourceId: row.resourceId,
              runId: row.runId,
              occurredAt: row.occurredAt,
              durationMs: row.durationMs,
            } as Extract<FactRow, { readonly _tag: "Completed" }>)
          : fact.append({
              _tag: "Completed",
              id: row.id,
              resourceId: row.resourceId,
              runId: row.runId,
              occurredAt: row.occurredAt,
              durationMs: row.durationMs,
              success: row.success,
            } as Extract<FactRow, { readonly _tag: "Completed" }>)),
      failed: (row: RunStoreFailedInput) =>
        fact.append({ _tag: "Failed", ...row } as Extract<FactRow, { readonly _tag: "Failed" }>),
    }),
  );
};

/** Engine write-extension contract for a tag. @internal */
export const engineRunResourceStoreContract = (tag: StoreScopeTag) =>
  makeEngineRunResourceStoreContract(successOf(tag), errorOf(tag));

/** Engine write-extension contract type. @internal */
export type EngineRunResourceStoreContract = ReturnType<
  typeof engineRunResourceStoreContract
>;

// ============================================================================
// Tier 3 — analytics read-extension (pure derivations over facts + state)
// ============================================================================

/**
 * Advanced analytics reads on `RunResource.store(tag)` — pure derivations over persisted facts and
 * state history, plus live {@link Store.changes} streams.
 * @internal
 */
export type RunStoreReads<Tag extends StoreScopeTag> = {
  readonly completed: () => Effect.Effect<ReadonlyArray<RunStoreCompleted<Tag>>>;
  readonly failed: () => Effect.Effect<ReadonlyArray<RunStoreFailed<Tag>>>;
  readonly recent: (n: number) => Effect.Effect<ReadonlyArray<RunStoreFact<Tag>>>;
  readonly history: (runId: string) => Effect.Effect<ReadonlyArray<RunStoreFact<Tag>>>;
  readonly lastFailure: () => Effect.Effect<Option.Option<RunStoreFailed<Tag>>>;
  readonly stats: () => Effect.Effect<RunStoreStats>;
  readonly failureRate: () => Effect.Effect<number>;
  readonly meanDurationMs: () => Effect.Effect<number>;
  readonly factChanges: () => Stream.Stream<
    RunStoreFact<Tag>,
    StoreJournalDecodeError,
    Store.Storage
  >;
  readonly stateChanges: () => Stream.Stream<
    RunStateChange,
    StoreJournalDecodeError,
    Store.Storage
  >;
};

/** Build the analytics read-extension contract for a tag. @internal */
export const makeRunResourceStoreAnalyticsContract = <const Tag extends StoreScopeTag>(
  tag: Tag,
) => {
  const tagFactSchema = runFactSchemaForTag(tag);
  type TagFactRow = Schema.Schema.Type<typeof tagFactSchema>;
  type TagCompleted = Extract<TagFactRow, { readonly _tag: "Completed" }>;
  type TagFailed = Extract<TagFactRow, { readonly _tag: "Failed" }>;
  type TagStarted = Extract<TagFactRow, { readonly _tag: "Started" }>;

  const isStarted = (row: TagFactRow): row is TagStarted => row._tag === "Started";
  const isCompleted = (row: TagFactRow): row is TagCompleted => row._tag === "Completed";
  const isFailed = (row: TagFactRow): row is TagFailed => row._tag === "Failed";

  const base = builtInRunResourceStoreContract(tag);
  const storeClass = { scopeKey: tag.key, contract: base };

  return Store.contract(
    {
      fact: Store.shape(tagFactSchema, runFactReadPayload),
      state: Store.shape(runStateChangeSchema, runStateReadPayload),
    },
    ({ fact, state }) => ({
      record: fact.append,
      facts: fact.read,
      recordStateChange: state.append,
      stateHistory: state.read,
      completed: (): Effect.Effect<ReadonlyArray<TagCompleted>> =>
        Effect.map(fact.read(), (rows) => rows.filter(isCompleted)),
      failed: (): Effect.Effect<ReadonlyArray<TagFailed>> =>
        Effect.map(fact.read(), (rows) => rows.filter(isFailed)),
      recent: (n: number): Effect.Effect<ReadonlyArray<TagFactRow>> =>
        Effect.map(fact.read(), (rows) =>
          n <= 0 ? [] : rows.slice(Math.max(0, rows.length - n)),
        ),
      history: (runId: string): Effect.Effect<ReadonlyArray<TagFactRow>> =>
        Effect.map(fact.read(), (rows) => rows.filter((row) => row.runId === runId)),
      lastFailure: (): Effect.Effect<Option.Option<TagFailed>> =>
        Effect.map(fact.read(), (rows) => {
          const failures = rows.filter(isFailed);
          return failures.length === 0
            ? Option.none()
            : Option.some(failures[failures.length - 1]!);
        }),
      stats: (): Effect.Effect<RunStoreStats> =>
        Effect.map(fact.read(), (rows) => {
          let started = 0;
          let completed = 0;
          let failed = 0;
          for (const row of rows) {
            if (isStarted(row)) started += 1;
            else if (isCompleted(row)) completed += 1;
            else if (isFailed(row)) failed += 1;
          }
          return { started, completed, failed };
        }),
      failureRate: (): Effect.Effect<number> =>
        Effect.map(fact.read(), (rows) => {
          let completed = 0;
          let failed = 0;
          for (const row of rows) {
            if (isCompleted(row)) completed += 1;
            else if (isFailed(row)) failed += 1;
          }
          const total = completed + failed;
          return total === 0 ? 0 : failed / total;
        }),
      meanDurationMs: (): Effect.Effect<number> =>
        Effect.map(fact.read(), (rows) => {
          const durations = rows.filter(isCompleted).map((row) => row.durationMs);
          if (durations.length === 0) return 0;
          return durations.reduce((a, b) => a + b, 0) / durations.length;
        }),
      factChanges: (): Stream.Stream<TagFactRow, StoreJournalDecodeError, Store.Storage> =>
        Stream.unwrap(Store.changes(storeClass, (shapes) => shapes.fact)),
      stateChanges: (): Stream.Stream<
        RunStateChange,
        StoreJournalDecodeError,
        Store.Storage
      > => Stream.unwrap(Store.changes(storeClass, (shapes) => shapes.state)),
    }),
  );
};

/** Analytics read-extension contract type for a tag. @internal */
export type RunResourceStoreAnalyticsContract<Tag extends StoreScopeTag> = ReturnType<
  typeof makeRunResourceStoreAnalyticsContract<Tag>
>;

/** @deprecated Internal flat spec — use {@link builtInRunResourceStoreContract}. @internal */
export const builtInRunResourceStoreSpec = (tag: StoreScopeTag) =>
  builtInRunResourceStoreContract(tag).spec;

export { runFactReadPayload };

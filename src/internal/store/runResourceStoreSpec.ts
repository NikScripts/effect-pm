/**
 * Built-in {@link RunResource} store contract.
 *
 * Three tiers (mirrors {@link QueueResource}):
 * - **Tier 1** — lean base (`builtInRunResourceStoreContract`)
 * - **Tier 2** — analytics read-extension (`makeRunResourceStoreAnalyticsContract`)
 *
 * Tier 2 composes tier 1 via {@link Store.extend} — shapes stay on tier 1;
 * the extension only adds analytics read methods. The engine writes via shape
 * `append` handles (`fact.append` / `state.append`) directly.
 *
 * @module internal/store/runResourceStoreSpec
 * @internal
 */

import { Effect, Option, Schema, Stream } from "effect";
import * as Store from "../../Store";
import { failureRate, recent } from "./analytics";
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

/** Read payload for built-in `facts`. @internal */
export type RunFactReadPayload = {
  readonly limit?: number;
  readonly runId?: string;
};

/** Shared write surface for tier-1 contracts. @internal */
type RunResourceStoreWrites = {
  readonly record: (fact: RunFact) => Effect.Effect<void, StoreWriteError>;
  readonly facts: (
    payload?: RunFactReadPayload,
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

/** Post-filter `fact.read` when `runId` is present on the read payload. @internal */
const factsRead = <Row extends { readonly runId: string }>(
  read: (payload?: RunFactReadPayload) => Effect.Effect<ReadonlyArray<Row>>,
) =>
  (payload?: RunFactReadPayload): Effect.Effect<ReadonlyArray<Row>> =>
    payload?.runId === undefined
      ? read(payload)
      : Effect.map(read(payload), (rows) => rows.filter((row) => row.runId === payload.runId));

/** Tier-1 custom methods over `fact` + `state` shape handles. @internal */
const runResourceTier1Methods = <FactRow extends { readonly runId: string }>({
  fact,
  state,
}: {
  readonly fact: {
    readonly append: (row: FactRow | ReadonlyArray<FactRow>) => Effect.Effect<void, StoreWriteError>;
    readonly read: (payload?: RunFactReadPayload) => Effect.Effect<ReadonlyArray<FactRow>>;
  };
  readonly state: {
    readonly append: (row: RunStateChange) => Effect.Effect<void, StoreWriteError>;
    readonly read: (payload?: { readonly limit?: number }) => Effect.Effect<ReadonlyArray<RunStateChange>>;
  };
}) => ({
  record: fact.append,
  facts: factsRead(fact.read),
  recordStateChange: state.append,
  stateHistory: state.read,
});

/** Build the run store contract (optional success / error schemas). @internal */
export const makeRunResourceStoreContract = (
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
    (handles) => runResourceTier1Methods<FactRow>(handles),
  );
};

/** Built-in run-resource store contract for a tag (reads `success` / `error` from tag). @internal */
export const builtInRunResourceStoreContract = <const Tag extends StoreScopeTag>(
  tag: Tag,
) => makeRunResourceStoreContract(successOf(tag), errorOf(tag));

// ============================================================================
// Tier 2 — analytics read-extension (pure derivations over facts + state)
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

/** Analytics derivations over a tag's fact rows. @internal */
const runResourceAnalyticsMethods = <
  TagFactRow extends { readonly _tag: string; readonly runId: string },
  TagCompleted extends TagFactRow,
  TagFailed extends TagFactRow,
  TagStarted extends TagFactRow,
>(options: {
  readonly fact: {
    readonly read: (payload?: RunFactReadPayload) => Effect.Effect<ReadonlyArray<TagFactRow>>;
  };
  readonly storeClass: { readonly scopeKey: string; readonly contract: StoreContractValue };
  readonly isStarted: (row: TagFactRow) => row is TagStarted;
  readonly isCompleted: (row: TagFactRow) => row is TagCompleted;
  readonly isFailed: (row: TagFactRow) => row is TagFailed;
}) => {
  const readAll = (): Effect.Effect<ReadonlyArray<TagFactRow>> => options.fact.read();

  return {
    completed: (): Effect.Effect<ReadonlyArray<TagCompleted>> =>
      Effect.map(readAll(), (rows) => rows.filter(options.isCompleted)),
    failed: (): Effect.Effect<ReadonlyArray<TagFailed>> =>
      Effect.map(readAll(), (rows) => rows.filter(options.isFailed)),
    recent: (n: number): Effect.Effect<ReadonlyArray<TagFactRow>> => recent(readAll, n),
    history: (runId: string): Effect.Effect<ReadonlyArray<TagFactRow>> =>
      Effect.map(options.fact.read(), (rows) => rows.filter((row) => row.runId === runId)),
    lastFailure: (): Effect.Effect<Option.Option<TagFailed>> =>
      Effect.map(readAll(), (rows) => {
        const failures = rows.filter(options.isFailed);
        return failures.length === 0
          ? Option.none()
          : Option.some(failures[failures.length - 1]!);
      }),
    stats: (): Effect.Effect<RunStoreStats> =>
      Effect.map(readAll(), (rows) => {
        let started = 0;
        let completed = 0;
        let failed = 0;
        for (const row of rows) {
          if (options.isStarted(row)) started += 1;
          else if (options.isCompleted(row)) completed += 1;
          else if (options.isFailed(row)) failed += 1;
        }
        return { started, completed, failed };
      }),
    failureRate: (): Effect.Effect<number> =>
      failureRate(readAll, options.isCompleted, options.isFailed),
    meanDurationMs: (): Effect.Effect<number> =>
      Effect.map(readAll(), (rows) => {
        const durations = rows
          .filter(options.isCompleted)
          .map((row) => (row as TagCompleted & { readonly durationMs: number }).durationMs);
        if (durations.length === 0) return 0;
        return durations.reduce((a, b) => a + b, 0) / durations.length;
      }),
    factChanges: (): Stream.Stream<TagFactRow, StoreJournalDecodeError, Store.Storage> =>
      Stream.unwrap(
        Store.changes(
          options.storeClass,
          (shapes) => (shapes as { readonly fact: (typeof shapes)["fact"] }).fact,
        ),
      ) as Stream.Stream<TagFactRow, StoreJournalDecodeError, Store.Storage>,
    stateChanges: (): Stream.Stream<RunStateChange, StoreJournalDecodeError, Store.Storage> =>
      Stream.unwrap(
        Store.changes(
          options.storeClass,
          (shapes) => (shapes as { readonly state: (typeof shapes)["state"] }).state,
        ),
      ) as Stream.Stream<RunStateChange, StoreJournalDecodeError, Store.Storage>,
  };
};

/** Analytics read-extension contract type for a tag. @internal */
export type RunResourceStoreAnalyticsContract<Tag extends StoreScopeTag> = ReturnType<
  typeof makeRunResourceStoreAnalyticsContract<Tag>
>;

/** Build the analytics read-extension contract for a tag. @internal */
export const makeRunResourceStoreAnalyticsContract = <const Tag extends StoreScopeTag>(
  tag: Tag,
) => {
  const _tagFactSchema = runFactSchemaForTag(tag);
  type TagFactRow = Schema.Schema.Type<typeof _tagFactSchema>;
  type TagCompleted = Extract<TagFactRow, { readonly _tag: "Completed" }>;
  type TagFailed = Extract<TagFactRow, { readonly _tag: "Failed" }>;
  type TagStarted = Extract<TagFactRow, { readonly _tag: "Started" }>;

  const isStarted = (row: TagFactRow): row is TagStarted => row._tag === "Started";
  const isCompleted = (row: TagFactRow): row is TagCompleted => row._tag === "Completed";
  const isFailed = (row: TagFactRow): row is TagFailed => row._tag === "Failed";

  const base = builtInRunResourceStoreContract(tag);
  const storeClass = { scopeKey: tag.key, contract: base };

  return Store.extend(
    (handles) =>
      runResourceAnalyticsMethods<TagFactRow, TagCompleted, TagFailed, TagStarted>({
        fact: handles.fact,
        storeClass,
        isStarted,
        isCompleted,
        isFailed,
      }),
    base,
  );
};

/** @deprecated Internal flat spec — use {@link builtInRunResourceStoreContract}. @internal */
export const builtInRunResourceStoreSpec = (tag: StoreScopeTag) =>
  builtInRunResourceStoreContract(tag).spec;

export { runFactReadPayload };

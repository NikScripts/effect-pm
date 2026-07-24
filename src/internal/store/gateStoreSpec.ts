/**
 * Built-in {@link Gate} store contract.
 *
 * Three tiers (mirrors {@link WorkPool}):
 * - **Tier 1** — lean base (`builtInGateStoreContract`)
 * - **Tier 2** — analytics read-extension (`makeGateStoreAnalyticsContract`)
 *
 * Tier 2 composes tier 1 via {@link Store.extend} — shapes stay on tier 1;
 * the extension only adds analytics read methods. The engine writes via shape
 * `append` handles (`fact.append` / `state.append`) directly.
 *
 * @module internal/store/gateStoreSpec
 * @internal
 */

import { Effect, Option, Schema, Stream } from "effect";
import * as Store from "../../Store";
import { failureRate, recent } from "./analytics";
import { makeGateFactEvent } from "../gateEvent";
import { errorOf, successOf } from "../gateTagSchemas";
import { gateStatus } from "../gateSchema";
import type { StoreContractValue, StoreShapeDef } from "./contractDef";
import type { StoreJournalDecodeError, StoreWriteError } from "./errors";
import { withImplicitLogShape } from "./logShapes";
import type { StoreScopeTag } from "./registration";

/** Reasons attached to gate state transitions. @internal */
export type GateStateChangeReason =
  | "Waiting"
  | "Started"
  | "Completed"
  | "Failed"
  | "Interrupted"
  | "WaitInterrupted";

/** Live gate counters persisted on state transitions. @internal */
export const gateStateSchema = gateStatus;

/** Default void run facts. @internal */
export const gateFactSchema = makeGateFactEvent();

/** State transition row — mirrors legacy `GateStateChange`. @internal */
export const gateStateChangeSchema = Schema.Struct({
  id: Schema.String,
  resourceId: Schema.String,
  changedAt: Schema.Number,
  reason: Schema.Literals([
    "Waiting",
    "Started",
    "Completed",
    "Failed",
    "Interrupted",
    "WaitInterrupted",
  ]),
  previous: Schema.NullOr(gateStateSchema),
  current: gateStateSchema,
});

/** Persisted run fact for the default void contract. @internal */
export type GateFact = Schema.Schema.Type<typeof gateFactSchema>;

/** Persisted state transition for a tag scope. @internal */
export type GateStateChange = Schema.Schema.Type<typeof gateStateChangeSchema>;

/** Decoded fact union persisted for a scope. @internal */
export type GateStoreFact<_Tag extends StoreScopeTag = StoreScopeTag> = GateFact;

/** Fact row schema for a tag scope. @internal */
export const gateFactSchemaForTag = (tag: StoreScopeTag) =>
  makeGateFactEvent(successOf(tag), errorOf(tag));

/** Type guard — `Started` fact row. @internal */
export const isGateStoreStarted = (
  row: { readonly _tag: string },
): row is GateStoreStarted => row._tag === "Started";

/** Type guard — `Completed` fact row. @internal */
export const isGateStoreCompleted = (
  row: { readonly _tag: string },
): row is GateStoreCompleted => row._tag === "Completed";

/** Type guard — `Failed` fact row. @internal */
export const isGateStoreFailed = (
  row: { readonly _tag: string },
): row is GateStoreFailed => row._tag === "Failed";

/** Decoded `Started` row. @internal */
export type GateStoreStarted<Tag extends StoreScopeTag = StoreScopeTag> = Extract<
  GateStoreFact<Tag>,
  { readonly _tag: "Started" }
>;

/** Decoded `Failed` row. @internal */
export type GateStoreFailed<Tag extends StoreScopeTag = StoreScopeTag> = Extract<
  GateStoreFact<Tag>,
  { readonly _tag: "Failed" }
>;

/** Decoded `Completed` row. @internal */
export type GateStoreCompleted<Tag extends StoreScopeTag = StoreScopeTag> = Extract<
  GateStoreFact<Tag>,
  { readonly _tag: "Completed" }
>;

/** Lifetime run fact counts. @internal */
export interface GateStoreStats {
  readonly started: number;
  readonly completed: number;
  readonly failed: number;
}

/** @deprecated Prefer `Store.StoreReadPayload<FactRow>` with `where: { runId }`. @internal */
export type GateFactReadPayload = Store.StoreReadPayload<GateFact>;

/** Shared write surface for tier-1 contracts. @internal */
type GateStoreWrites = {
  readonly record: (fact: GateFact) => Effect.Effect<void, StoreWriteError>;
  readonly facts: (
    payload?: Store.StoreReadPayload<GateFact>,
  ) => Effect.Effect<ReadonlyArray<GateFact>>;
  readonly recordStateChange: (change: GateStateChange) => Effect.Effect<void, StoreWriteError>;
  readonly stateHistory: (
    payload?: Store.StoreReadPayload<GateStateChange>,
  ) => Effect.Effect<ReadonlyArray<GateStateChange>>;
};

/** Built-in Gate store contract (tier 1). @internal */
export type BuiltInGateContract = StoreContractValue<
  {
    readonly fact: StoreShapeDef<typeof gateFactSchema>;
    readonly state: StoreShapeDef<typeof gateStateChangeSchema>;
  },
  GateStoreWrites
>;

/** Tier-1 custom methods over `fact` + `state` shape handles. @internal */
const gateTier1Methods = <FactRow extends { readonly runId: string }>({
  fact,
  state,
}: {
  readonly fact: {
    readonly append: (row: FactRow | ReadonlyArray<FactRow>) => Effect.Effect<void, StoreWriteError>;
    readonly read: (
      payload?: Store.StoreReadPayload<FactRow>,
    ) => Effect.Effect<ReadonlyArray<FactRow>>;
  };
  readonly state: {
    readonly append: (row: GateStateChange) => Effect.Effect<void, StoreWriteError>;
    readonly read: (
      payload?: Store.StoreReadPayload<GateStateChange>,
    ) => Effect.Effect<ReadonlyArray<GateStateChange>>;
  };
}) => ({
  record: fact.append,
  // Prefer `facts({ where: { runId } })` — system `where` replaces the old runId payload field.
  facts: fact.read,
  recordStateChange: state.append,
  stateHistory: state.read,
});

/** Build the run store contract (optional success / error schemas). @internal */
export const makeGateStoreContract = (
  success?: Schema.Top,
  error?: Schema.Top,
) => {
  const factSchema = makeGateFactEvent(success, error);
  type FactRow = Schema.Schema.Type<typeof factSchema>;
  return Store.contract(
    {
      fact: Store.shape(factSchema),
      state: Store.shape(gateStateChangeSchema),
    },
    (handles) => gateTier1Methods<FactRow>(handles),
  );
};

/** Built-in Gate store contract for a tag (reads `success` / `error` from tag). @internal */
export const builtInGateStoreContract = <const Tag extends StoreScopeTag>(
  tag: Tag,
) => makeGateStoreContract(successOf(tag), errorOf(tag));

// ============================================================================
// Tier 2 — analytics read-extension (pure derivations over facts + state)
// ============================================================================

/**
 * Advanced analytics reads on `Gate.store(tag)` — pure derivations over persisted facts and
 * state history, plus live {@link Store.changes} streams.
 * @internal
 */
export type GateStoreReads<Tag extends StoreScopeTag> = {
  readonly completed: () => Effect.Effect<ReadonlyArray<GateStoreCompleted<Tag>>>;
  readonly failed: () => Effect.Effect<ReadonlyArray<GateStoreFailed<Tag>>>;
  readonly recent: (n: number) => Effect.Effect<ReadonlyArray<GateStoreFact<Tag>>>;
  readonly history: (runId: string) => Effect.Effect<ReadonlyArray<GateStoreFact<Tag>>>;
  readonly lastFailure: () => Effect.Effect<Option.Option<GateStoreFailed<Tag>>>;
  readonly stats: () => Effect.Effect<GateStoreStats>;
  readonly failureRate: () => Effect.Effect<number>;
  readonly meanDurationMs: () => Effect.Effect<number>;
  readonly factChanges: () => Stream.Stream<
    GateStoreFact<Tag>,
    StoreJournalDecodeError,
    Store.Storage
  >;
  readonly stateChanges: () => Stream.Stream<
    GateStateChange,
    StoreJournalDecodeError,
    Store.Storage
  >;
};

/** Analytics derivations over a tag's fact rows. @internal */
const gateAnalyticsMethods = <
  TagFactRow extends { readonly _tag: string; readonly runId: string },
  TagCompleted extends TagFactRow,
  TagFailed extends TagFactRow,
  TagStarted extends TagFactRow,
>(options: {
  readonly fact: {
    readonly read: (payload?: GateFactReadPayload) => Effect.Effect<ReadonlyArray<TagFactRow>>;
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
    stats: (): Effect.Effect<GateStoreStats> =>
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
    stateChanges: (): Stream.Stream<GateStateChange, StoreJournalDecodeError, Store.Storage> =>
      Stream.unwrap(
        Store.changes(
          options.storeClass,
          (shapes) => (shapes as { readonly state: (typeof shapes)["state"] }).state,
        ),
      ) as Stream.Stream<GateStateChange, StoreJournalDecodeError, Store.Storage>,
  };
};

/** Analytics read-extension contract type for a tag. @internal */
export type GateStoreAnalyticsContract<Tag extends StoreScopeTag> = ReturnType<
  typeof makeGateStoreAnalyticsContract<Tag>
>;

/** Build the analytics read-extension contract for a tag. @internal */
export const makeGateStoreAnalyticsContract = <const Tag extends StoreScopeTag>(
  tag: Tag,
) => {
  const _tagFactSchema = gateFactSchemaForTag(tag);
  type TagFactRow = Schema.Schema.Type<typeof _tagFactSchema>;
  type TagCompleted = Extract<TagFactRow, { readonly _tag: "Completed" }>;
  type TagFailed = Extract<TagFactRow, { readonly _tag: "Failed" }>;
  type TagStarted = Extract<TagFactRow, { readonly _tag: "Started" }>;

  const isStarted = (row: TagFactRow): row is TagStarted => row._tag === "Started";
  const isCompleted = (row: TagFactRow): row is TagCompleted => row._tag === "Completed";
  const isFailed = (row: TagFactRow): row is TagFailed => row._tag === "Failed";

  const base = builtInGateStoreContract(tag);
  const storeClass = { scopeKey: tag.key, contract: base };

  return withImplicitLogShape(
    Store.extend(
      (handles) =>
        gateAnalyticsMethods<TagFactRow, TagCompleted, TagFailed, TagStarted>({
          fact: handles.fact,
          storeClass,
          isStarted,
          isCompleted,
          isFailed,
        }),
      base,
    ),
  );
};

/** @deprecated Internal flat spec — use {@link builtInGateStoreContract}. @internal */
export const builtInGateStoreSpec = (tag: StoreScopeTag) =>
  builtInGateStoreContract(tag).spec;

/** @deprecated Use {@link Store.StoreReadPayload}. @internal */
export { gateFactReadPayload } from "../gateEvent";

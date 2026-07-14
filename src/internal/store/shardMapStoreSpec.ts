/**
 * Built-in {@link ShardMap} store contract.
 *
 * Event-sourced Map: `Put` / `Delete` rows on one `event` shape. The engine hydrates the
 * in-memory shard from `events()` on build and appends on every `putLocal` / `deleteLocal`.
 *
 * - **Tier 1** — lean base (`builtInShardMapStoreContract`)
 * - **Tier 2** — analytics read-extension (`makeShardMapStoreAnalyticsContract`)
 *
 * @module internal/store/shardMapStoreSpec
 * @internal
 */

import { Effect, Schema, Stream, pipe } from "effect";
import * as Store from "../../Store";
import type {
  CatchWriteError,
  Storage,
  StoreEffectsOf,
  StoreProvidedContext,
} from "../../Store";
import { recent } from "./analytics";
import type { StoreContractValue, StoreShapeDef } from "./contractDef";
import type { StoreJournalDecodeError, StoreWriteError } from "./errors";
import type { StoreScopeTag } from "./registration";
import { valueSchemaSym } from "../shardMapSymbols";

/** Tag shape for store registration — carries the value schema stamp. @internal */
export interface ShardMapStoreTag extends StoreScopeTag {
  readonly [valueSchemaSym]: Schema.Top;
}

/** Read the value schema stamped on a ShardMap tag. @internal */
export const valueSchemaOf = (tag: ShardMapStoreTag): Schema.Top => tag[valueSchemaSym];

/** Read payload for built-in `events`. @internal */
export const shardMapEventReadPayload = Schema.Struct({
  limit: Schema.optional(Schema.Number),
});

/**
 * Put / Delete union for a value schema. Value is kept as {@link Schema.Top} at the contract
 * boundary (same erasure as queue success) so Union `.Type` stays usable; typed `V` rides the
 * decoded analytics surface.
 *
 * @internal
 */
export const makeShardMapEntryEvent = (valueSchema: Schema.Top = Schema.Unknown) =>
  Schema.Union([
    Schema.TaggedStruct("Put", {
      key: Schema.String,
      value: valueSchema,
      at: Schema.Number,
    }),
    Schema.TaggedStruct("Delete", {
      key: Schema.String,
      at: Schema.Number,
    }),
  ]);

/** Default (erased) entry-event schema. @internal */
export const shardMapEntryEventSchema = makeShardMapEntryEvent();

/** Persisted entry event for a tag (value erased at schema; typed at analytics). @internal */
export type ShardMapEntryEvent<V = unknown> =
  | { readonly _tag: "Put"; readonly key: string; readonly value: V; readonly at: number }
  | { readonly _tag: "Delete"; readonly key: string; readonly at: number };

/** Decoded Put row. @internal */
export type ShardMapStorePut<V = unknown> = Extract<
  ShardMapEntryEvent<V>,
  { readonly _tag: "Put" }
>;

/** Decoded Delete row. @internal */
export type ShardMapStoreDelete = Extract<
  ShardMapEntryEvent,
  { readonly _tag: "Delete" }
>;

/** Fold Put/Delete rows into the current Map (last-write-wins per key). @internal */
export const foldShardMapEntries = <V>(
  rows: ReadonlyArray<ShardMapEntryEvent<V>>,
): Map<string, V> => {
  const map = new Map<string, V>();
  for (const row of rows) {
    if (row._tag === "Put") {
      map.set(row.key, row.value);
    } else {
      map.delete(row.key);
    }
  }
  return map;
};

/** Type guard — Put row. @internal */
export const isShardMapPut = <V>(
  row: ShardMapEntryEvent<V>,
): row is ShardMapStorePut<V> => row._tag === "Put";

/** Type guard — Delete row. @internal */
export const isShardMapDelete = (
  row: ShardMapEntryEvent,
): row is ShardMapStoreDelete => row._tag === "Delete";

/** Shared write surface for tier-1 contracts. @internal */
type ShardMapStoreWrites = {
  readonly record: (event: ShardMapEntryEvent) => Effect.Effect<void, StoreWriteError>;
  readonly events: (
    payload?: { readonly limit?: number },
  ) => Effect.Effect<ReadonlyArray<ShardMapEntryEvent>>;
};

/** Built-in shard-map store contract (tier 1). @internal */
export type BuiltInShardMapContract = StoreContractValue<
  {
    readonly event: StoreShapeDef<
      typeof shardMapEntryEventSchema,
      typeof shardMapEventReadPayload
    >;
  },
  ShardMapStoreWrites
>;

/** Tier-1 custom methods over the `event` shape handle. @internal */
const shardMapTier1Methods = ({
  event,
}: {
  readonly event: {
    readonly append: (
      row: ShardMapEntryEvent | ReadonlyArray<ShardMapEntryEvent>,
    ) => Effect.Effect<void, StoreWriteError>;
    readonly read: (
      payload?: { readonly limit?: number },
    ) => Effect.Effect<ReadonlyArray<ShardMapEntryEvent>>;
  };
}) => ({
  record: event.append,
  events: event.read,
});

/** Build the store contract for a value schema. @internal */
export const makeShardMapStoreContract = (valueSchema: Schema.Top = Schema.Unknown) => {
  const eventSchema = makeShardMapEntryEvent(valueSchema);
  return Store.contract(
    {
      event: Store.shape(eventSchema, shardMapEventReadPayload),
    },
    (handles) => shardMapTier1Methods(handles as Parameters<typeof shardMapTier1Methods>[0]),
  );
};

/** Built-in shard-map store contract for a tag. @internal */
export const builtInShardMapStoreContract = <const Tag extends ShardMapStoreTag>(
  tag: Tag,
): BuiltInShardMapContract =>
  makeShardMapStoreContract(valueSchemaOf(tag)) as BuiltInShardMapContract;

/** Lifetime entry-event counts + reconstructed size. @internal */
export interface ShardMapStoreStats {
  readonly puts: number;
  readonly deletes: number;
  readonly currentSize: number;
}

/**
 * Analytics reads on {@link ShardMap.store} — pure derivations over `event.read`, plus live
 * {@link Store.changes}.
 * @internal
 */
export type ShardMapStoreReads<V = unknown> = {
  readonly puts: () => Effect.Effect<ReadonlyArray<ShardMapStorePut<V>>>;
  readonly deletes: () => Effect.Effect<ReadonlyArray<ShardMapStoreDelete>>;
  readonly recent: (n: number) => Effect.Effect<ReadonlyArray<ShardMapEntryEvent<V>>>;
  /** Reconstructed shard values (fold Put/Delete in order). */
  readonly current: () => Effect.Effect<ReadonlyArray<V>>;
  readonly stats: () => Effect.Effect<ShardMapStoreStats>;
  readonly changes: () => Stream.Stream<
    ShardMapEntryEvent<V>,
    StoreJournalDecodeError,
    Store.Storage
  >;
};

/** Analytics derivations over entry-event rows. @internal */
const shardMapAnalyticsMethods = <V>(options: {
  readonly event: {
    readonly read: (
      payload?: { readonly limit?: number },
    ) => Effect.Effect<ReadonlyArray<ShardMapEntryEvent<V>>>;
  };
  readonly storeClass: { readonly scopeKey: string; readonly contract: StoreContractValue };
}) => {
  const readAll = (): Effect.Effect<ReadonlyArray<ShardMapEntryEvent<V>>> =>
    options.event.read();

  return {
    puts: (): Effect.Effect<ReadonlyArray<ShardMapStorePut<V>>> =>
      Effect.map(readAll(), (rows) => rows.filter(isShardMapPut)),
    deletes: (): Effect.Effect<ReadonlyArray<ShardMapStoreDelete>> =>
      Effect.map(readAll(), (rows) => rows.filter(isShardMapDelete)),
    recent: (n: number): Effect.Effect<ReadonlyArray<ShardMapEntryEvent<V>>> =>
      recent(readAll, n),
    current: (): Effect.Effect<ReadonlyArray<V>> =>
      Effect.map(readAll(), (rows) => [...foldShardMapEntries(rows).values()]),
    stats: (): Effect.Effect<ShardMapStoreStats> =>
      Effect.map(readAll(), (rows) => {
        let puts = 0;
        let deletes = 0;
        for (const row of rows) {
          if (row._tag === "Put") puts += 1;
          else deletes += 1;
        }
        return { puts, deletes, currentSize: foldShardMapEntries(rows).size };
      }),
    changes: (): Stream.Stream<
      ShardMapEntryEvent<V>,
      StoreJournalDecodeError,
      Store.Storage
    > =>
      Stream.unwrap(
        Store.changes(
          options.storeClass,
          (shapes) =>
            (shapes as { readonly event: (typeof shapes)["event"] }).event,
        ),
      ) as Stream.Stream<
        ShardMapEntryEvent<V>,
        StoreJournalDecodeError,
        Store.Storage
      >,
  };
};

/** Public analytics contract type for {@link ShardMap.store}. @internal */
export type ShardMapStoreAnalyticsContract<Tag extends ShardMapStoreTag> = ReturnType<
  typeof makeShardMapStoreAnalyticsContract<Tag>
>;

/** Build the analytics read-extension contract for a tag. @internal */
export const makeShardMapStoreAnalyticsContract = <const Tag extends ShardMapStoreTag>(
  tag: Tag,
) => {
  const base = builtInShardMapStoreContract(tag);
  const storeClass = { scopeKey: tag.key, contract: base };
  return Store.extend(
    (handles) =>
      shardMapAnalyticsMethods({
        event: handles.event as {
          readonly read: (
            payload?: { readonly limit?: number },
          ) => Effect.Effect<ReadonlyArray<ShardMapEntryEvent>>;
        },
        storeClass,
      }),
    base,
  );
};

/**
 * Storage-free engine store handle — SSOT after {@link Store.catchWriteErrors} +
 * {@link Store.provideContext}.
 * @internal
 */
export type MaterializedEngineShardMapStore = StoreProvidedContext<
  CatchWriteError<StoreEffectsOf<BuiltInShardMapContract>>,
  Storage
>;

/** Materialize engine store effects for a ShardMap tag. @internal */
export const materializeEngineShardMapStore = (
  tag: ShardMapStoreTag,
): Effect.Effect<MaterializedEngineShardMapStore, never, Storage> =>
  Effect.gen(function* () {
    const storageContext = yield* Effect.context<Storage>();
    const storeEffects = pipe(
      Store.effects(tag.key, builtInShardMapStoreContract(tag)),
      Store.catchWriteErrors,
    );
    return Store.provideContext(storeEffects, storageContext);
  });

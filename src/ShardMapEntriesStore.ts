/**
 * **ShardMapEntriesStore** — prototype keyed *current-state* port for {@link ShardMap}.
 *
 * Contrast with the mistaken Put/Delete event log on {@link ShardMap.store}: the product here is
 * **live key → value rows**, not a mutation history. Recover = `entries(scope)` once, not replay.
 *
 * Shape mirrors {@link DurableQueueStore} (backend-agnostic port, `scopeKey` like `queueId`), but
 * an in-memory default **does** carry value for Map state during a process — so this is a
 * **defaulted** service (layers merge {@link layerMemory}), not `serviceOption`.
 *
 * Not yet wired into {@link ShardMap.layer}; this file is the cutover target.
 *
 * @module ShardMapEntriesStore
 * @internal prototype — promote to public + SQLite backend when cutting over ShardMap persistence
 */
import { Context, Effect, Layer, Option, Ref } from "effect";

/** Opaque encoded value — caller owns schema encode/decode (same as DurableQueueStore payload). */
export type EncodedValue = unknown;

/** One live row. */
export interface ShardMapEntry {
  readonly scopeKey: string;
  readonly key: string;
  readonly value: EncodedValue;
}

/** Backend-agnostic keyed Map port. */
export interface ShardMapEntriesStoreShape {
  /** Current value for `key` in `scopeKey`, if any. */
  readonly get: (
    scopeKey: string,
    key: string,
  ) => Effect.Effect<Option.Option<EncodedValue>>;

  /** Upsert — one live row per `(scopeKey, key)`. */
  readonly put: (
    scopeKey: string,
    key: string,
    value: EncodedValue,
  ) => Effect.Effect<void>;

  /** Remove the row; `true` when something was deleted. */
  readonly delete: (
    scopeKey: string,
    key: string,
  ) => Effect.Effect<boolean>;

  /**
   * All live rows for a scope — **boot hydrate**. O(live keys), not O(history).
   */
  readonly entries: (
    scopeKey: string,
  ) => Effect.Effect<ReadonlyArray<ShardMapEntry>>;

  /** Live row count for a scope (fleet `sizeLocal` can prefer this once hot path is store-backed). */
  readonly size: (scopeKey: string) => Effect.Effect<number>;
}

/**
 * Defaulted service — always resolvable when toolkit layers merge {@link layerMemory}.
 *
 * @example Engine (target wiring)
 * ```ts
 * const entries = yield* ShardMapEntriesStore
 * const seeded = new Map(
 *   (yield* entries.entries(tag.key)).map((row) => [row.key, row.value] as const),
 * )
 * const local = yield* Ref.make(seeded)
 * // putLocal: yield* entries.put(tag.key, wire, value); yield* Ref.update(...)
 * ```
 */
export class ShardMapEntriesStore extends Context.Service<
  ShardMapEntriesStore,
  ShardMapEntriesStoreShape
>()("@nikscripts/effect-pm/ShardMapEntriesStore") {}

type ScopeMap = Map<string, EncodedValue>;

/** In-memory backend — nested `scopeKey → (key → value)`. */
export const makeMemory = (): Effect.Effect<ShardMapEntriesStoreShape> =>
  Effect.gen(function* () {
    const scopes = yield* Ref.make(new Map<string, ScopeMap>());

    const scopeOf = (scopeKey: string) =>
      Ref.get(scopes).pipe(
        Effect.map((m) => m.get(scopeKey) ?? new Map<string, EncodedValue>()),
      );

    return {
      get: (scopeKey, key) =>
        scopeOf(scopeKey).pipe(
          Effect.map((rows) => Option.fromNullishOr(rows.get(key))),
        ),

      put: (scopeKey, key, value) =>
        Ref.update(scopes, (all) => {
          const next = new Map(all);
          const rows = new Map(next.get(scopeKey) ?? []);
          rows.set(key, value);
          next.set(scopeKey, rows);
          return next;
        }),

      delete: (scopeKey, key) =>
        Ref.modify(scopes, (all) => {
          const rows = all.get(scopeKey);
          if (rows === undefined || !rows.has(key)) {
            return [false, all] as const;
          }
          const nextRows = new Map(rows);
          nextRows.delete(key);
          const next = new Map(all);
          if (nextRows.size === 0) next.delete(scopeKey);
          else next.set(scopeKey, nextRows);
          return [true, next] as const;
        }),

      entries: (scopeKey) =>
        scopeOf(scopeKey).pipe(
          Effect.map((rows) =>
            [...rows.entries()].map(([key, value]) => ({
              scopeKey,
              key,
              value,
            })),
          ),
        ),

      size: (scopeKey) =>
        scopeOf(scopeKey).pipe(Effect.map((rows) => rows.size)),
    } satisfies ShardMapEntriesStoreShape;
  });

/** Baked-in default — merge into {@link ShardMap.layer} / `serve` (apps override with SQLite later). */
export const layerMemory: Layer.Layer<ShardMapEntriesStore> = Layer.effect(
  ShardMapEntriesStore,
  makeMemory(),
);

/**
 * Sketch: how {@link ShardMap} `buildImpl` hydrates + writes once this replaces the event log.
 * Kept here so the cutover diff stays mechanical.
 */
export const hydrateLocalMap = (
  scopeKey: string,
): Effect.Effect<Map<string, EncodedValue>, never, ShardMapEntriesStore> =>
  Effect.gen(function* () {
    const store = yield* ShardMapEntriesStore;
    const rows = yield* store.entries(scopeKey);
    return new Map(rows.map((row) => [row.key, row.value] as const));
  });

/**
 * ShardMap — partitioned key/value Resource factory.
 *
 * One map across a fleet of nodes: declare `key` / `value` schemas, distribute across
 * `app/Droplet*` nodes, and every routed `get` / `put` / `delete` forwards to the owning
 * shard via {@link Resource.peers}. Leaf `*Local` ops stay on this node. Fleet folds report
 * shard sizes. An unreachable owner degrades to a miss — not a cascading health failure.
 *
 * Persistence: the local shard is **SQLite SSOT** (table `effect_pm_shard_map`).
 * {@link layer} / {@link serve} / {@link serveRemote} open an in-memory SQLite client by
 * default (`:memory:`); pass `{ filename }` for a durable file. Boot `SELECT`s live rows;
 * mutations `UPSERT` / `DELETE`. No Store bridge, no event replay.
 *
 * @example
 * class Sessions extends ShardMap.Tag<Sessions>()("app/Sessions", {
 *   key: Schema.String,
 *   value: Schema.Struct({ id: Schema.String, userId: Schema.String }),
 *   keyOf: (s) => s.id,
 * }).pipe(Resource.distributed([DropletEast, DropletWest])) {}
 *
 * @module ShardMap
 */
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { Effect, Layer, Option, Ref, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql/SqlClient";
import { Combine, combineQuery } from "./MultiNode";
import * as Resource from "./Resource";
import {
  Tag as resourceTag,
  type Local,
  type NodeBoundTag,
  type NodeKey,
  type PeersId,
  type ResourceTag,
  type SelfNodeId,
} from "./Resource";
import * as internal from "./internal/shardMap";
import * as shardMapSql from "./internal/shardMapSql";

// ============================================================================
// Public constants + partition
// ============================================================================

/**
 * This contract's canonical kind (stamped on every tag; read via `Resource.kindOf`).
 *
 * @public
 */
export const kind = "@nikscripts/effect-pm/ShardMap";

/**
 * Stable owner pick for a **fixed** node set — sort keys, then `Hash.string` modulo.
 * Remapping when membership changes is intentional / explicit (v1 = fixed fleet).
 *
 * @public
 */
export const consistentHash = internal.consistentHash;

/**
 * Partition function — maps a wire key string onto a node key.
 *
 * @public
 */
export type PartitionFn = internal.PartitionFn;

/**
 * Options for {@link layer} / {@link serve} / {@link serveRemote}.
 *
 * @public
 */
export type ShardMapOptions = internal.ShardMapOptions;

/**
 * Provide {@link SqlClient} (default `:memory:`) and install the shard-map schema before the
 * resource layer builds.
 *
 * @internal
 */
const withSqlite = <A, E, R>(
  options: ShardMapOptions | undefined,
  layer: Layer.Layer<A, E, R | SqlClient>,
): Layer.Layer<A, E, R> => {
  const filename = options?.filename ?? ":memory:";
  const install = Layer.effectDiscard(
    Effect.flatMap(SqlClient, (sql) =>
      shardMapSql.install(sql).pipe(Effect.orDie),
    ),
  );
  return layer.pipe(
    Layer.provide(install),
    Layer.provide(SqliteClient.layer({ filename })),
  );
};

// ============================================================================
// Spec builder
// ============================================================================

const buildShardMapSpec = <
  Key extends Schema.Top,
  Value extends Schema.Top,
  Error extends Schema.Top,
>(
  key: Key,
  value: Value,
  error: Error,
) => {
  const optionValue = Schema.Option(value);
  return {
    get: Resource.effectFn({
      payload: key,
      success: optionValue,
      error,
    }).annotate({
      description:
        "Value for `key` from whichever node owns the shard (miss if unreachable).",
    }),
    put: Resource.effectFn({
      payload: value,
      success: Schema.Boolean,
      error,
    }).annotate({
      description:
        "Upsert on the owning node (key via `keyOf`); `true` when written, `false` if owner unreachable.",
    }),
    delete: Resource.effectFn({
      payload: key,
      success: Schema.Boolean,
      error,
    }).annotate({
      description: "Delete on the owning node; `true` when an entry was removed.",
    }),
    getLocal: Resource.effectFn({
      payload: key,
      success: optionValue,
      error,
    }).annotate({
      description: "Read from this node's shard only (no forward).",
    }),
    putLocal: Resource.effectFn({
      payload: value,
      success: Schema.Void,
      error,
    }).annotate({
      description: "Write into this node's shard only (no forward).",
    }),
    deleteLocal: Resource.effectFn({
      payload: key,
      success: Schema.Boolean,
      error,
    }).annotate({
      description: "Delete from this node's shard only.",
    }),
    sizeLocal: Resource.effect(Schema.Number).annotate({
      description: "Entry count on this node's shard.",
    }),
    sizeByNode: Resource.effect(Schema.Record(Schema.String, Schema.Number))
      .pipe(Resource.fleet)
      .annotate({
        description: "Shard sizes keyed by node (`Resource.peers` + self).",
      }),
    size: Resource.effect(Schema.Number).pipe(Resource.fleet).annotate({
      description: "Sum of shard sizes across the mesh.",
    }),
  };
};

/**
 * Build a ShardMap instance spec from key/value schemas (failure channel = Never).
 *
 * @public
 */
export function shardMapSpec<Key extends Schema.Top, Value extends Schema.Top>(
  schemas: {
    readonly key: Key;
    readonly value: Value;
    readonly error?: undefined;
  },
): ReturnType<
  typeof buildShardMapSpec<Key, Value, typeof Schema.Never>
>;
/**
 * Build a ShardMap instance spec from key/value/error schemas.
 *
 * @public
 */
export function shardMapSpec<
  Key extends Schema.Top,
  Value extends Schema.Top,
  Error extends Schema.Top,
>(schemas: {
  readonly key: Key;
  readonly value: Value;
  readonly error: Error;
}): ReturnType<typeof buildShardMapSpec<Key, Value, Error>>;
export function shardMapSpec<
  Key extends Schema.Top,
  Value extends Schema.Top,
  Error extends Schema.Top,
>(schemas: {
  readonly key: Key;
  readonly value: Value;
  readonly error?: Error;
}) {
  if (schemas.error === undefined) {
    return buildShardMapSpec(schemas.key, schemas.value, Schema.Never);
  }
  return buildShardMapSpec(schemas.key, schemas.value, schemas.error);
}

/**
 * Spec produced by {@link shardMapSpec}.
 *
 * @public
 */
export type ShardMapSpecOf<
  Key extends Schema.Top,
  Value extends Schema.Top,
  Error extends Schema.Top = typeof Schema.Never,
> = ReturnType<typeof buildShardMapSpec<Key, Value, Error>>;

// ============================================================================
// Tag
// ============================================================================

/**
 * A ShardMap instance tag.
 *
 * @public
 */
export type ShardMapTag<
  Self,
  Key extends Schema.Top,
  Value extends Schema.Top,
  Error extends Schema.Top = typeof Schema.Never,
> = ResourceTag<Self, ShardMapSpecOf<Key, Value, Error>> & {
  readonly [internal.keySchemaSym]: Key;
  readonly [internal.valueSchemaSym]: Value;
  readonly [internal.keyOfSym]: (
    value: Schema.Schema.Type<Value>,
  ) => Schema.Schema.Type<Key>;
};

/**
 * A node-bound {@link ShardMapTag}.
 *
 * @public
 */
export type ShardMapNodeTag<
  Self,
  HSelf,
  Key extends Schema.Top,
  Value extends Schema.Top,
  Error extends Schema.Top = typeof Schema.Never,
> = NodeBoundTag<Self, ShardMapSpecOf<Key, Value, Error>, HSelf> & {
  readonly [internal.keySchemaSym]: Key;
  readonly [internal.valueSchemaSym]: Value;
  readonly [internal.keyOfSym]: (
    value: Schema.Schema.Type<Value>,
  ) => Schema.Schema.Type<Key>;
};

/**
 * Tag-construction schemas + `keyOf` for routed `put`.
 *
 * @public
 */
export interface ShardMapSchemas<
  Key extends Schema.Top,
  Value extends Schema.Top,
  Error extends Schema.Top = typeof Schema.Never,
> {
  readonly key: Key;
  readonly value: Value;
  readonly error?: Error;
  /** Extract the partition key from a value (routed `put` / `putLocal`). */
  readonly keyOf: (
    value: Schema.Schema.Type<Value>,
  ) => Schema.Schema.Type<Key>;
  readonly description?: string;
  readonly node?: NodeKey<unknown>;
}

/**
 * Declare a ShardMap tag — schemas on the Tag; partition strategy is a runtime option on
 * {@link layer} / {@link serve}.
 *
 * @example
 * class Sessions extends ShardMap.Tag<Sessions>()("app/Sessions", {
 *   key: SessionId,
 *   value: Session,
 *   keyOf: (s) => s.id,
 * }).pipe(Resource.distributed([DropletEast, DropletWest])) {}
 *
 * @public
 */
export const Tag =
  <Self>() =>
  <
    Key extends Schema.Top,
    Value extends Schema.Top,
    Error extends Schema.Top = typeof Schema.Never,
  >(
    key: string,
    schemas: ShardMapSchemas<Key, Value, Error>,
  ): ShardMapTag<Self, Key, Value, Error> => {
    const error =
      schemas.error === undefined ? Schema.Never : schemas.error;
    const spec = buildShardMapSpec(schemas.key, schemas.value, error);
    const tag =
      schemas.node === undefined
        ? resourceTag<Self>()(key, spec, {
            kind,
            description: schemas.description,
          })
        : resourceTag<Self>()(key, spec, {
            kind,
            description: schemas.description,
            node: schemas.node,
          });
    // SAFE: ResourceTag + schema stamps = ShardMapTag; Spec/Symbol identity is opaque under Top
    // (same boundary as QueueResource's `nameQueueService`).
    return Object.assign(tag, {
      [internal.keySchemaSym]: schemas.key,
      [internal.valueSchemaSym]: schemas.value,
      [internal.keyOfSym]: schemas.keyOf,
    }) as unknown as ShardMapTag<Self, Key, Value, Error>;
  };

// ============================================================================
// Engine (Telemetry posture: generic buildImpl in the public module)
// ============================================================================

type KeyT<Key extends Schema.Top> = Schema.Schema.Type<Key>;
type ValueT<Value extends Schema.Top> = Schema.Schema.Type<Value>;

/**
 * Leaf peer surface used by routed/`size*` folds — the PeerServices mapped type does not
 * reduce under Schema.Top Key/Value (same opacity Resource.peersLayer documents).
 *
 * @internal
 */
type PeerLeaf<Key extends Schema.Top, Value extends Schema.Top> = {
  readonly getLocal: (
    key: KeyT<Key>,
  ) => Effect.Effect<Option.Option<ValueT<Value>>>;
  readonly putLocal: (value: ValueT<Value>) => Effect.Effect<void>;
  readonly deleteLocal: (key: KeyT<Key>) => Effect.Effect<boolean>;
  readonly sizeLocal: Effect.Effect<number>;
};

/**
 * Concrete engine handlers — written against decoded Key/Value types. `Resource.ImplOf` under
 * Schema.Top does not reduce to this shape (Telemetry avoids the problem via a concrete Spec);
 * {@link asImpl} / {@link asServeImpl} are the documented boundary.
 *
 * @internal
 */
type ShardMapImpl<Key extends Schema.Top, Value extends Schema.Top> = {
  readonly get: (
    key: KeyT<Key>,
  ) => Effect.Effect<Option.Option<ValueT<Value>>>;
  readonly put: (value: ValueT<Value>) => Effect.Effect<boolean>;
  readonly delete: (key: KeyT<Key>) => Effect.Effect<boolean>;
  readonly getLocal: (
    key: KeyT<Key>,
  ) => Effect.Effect<Option.Option<ValueT<Value>>>;
  readonly putLocal: (value: ValueT<Value>) => Effect.Effect<void>;
  readonly deleteLocal: (key: KeyT<Key>) => Effect.Effect<boolean>;
  readonly sizeLocal: Effect.Effect<number>;
  readonly sizeByNode: Effect.Effect<Readonly<Record<string, number>>>;
  readonly size: Effect.Effect<number>;
};

/**
 * The served SQL-backed shard + routed/fleet members. Requires {@link Resource.peers} /
 * {@link Resource.selfNode} and {@link SqlClient} (toolkit layers install schema + provide a
 * default `:memory:` client).
 *
 * @internal
 */
const buildImpl = <
  Self,
  Key extends Schema.Top,
  Value extends Schema.Top,
  Error extends Schema.Top,
>(
  tag: ShardMapTag<Self, Key, Value, Error>,
  options?: ShardMapOptions,
): Effect.Effect<
  ShardMapImpl<Key, Value>,
  never,
  PeersId<Self> | SelfNodeId<Self> | SqlClient
> =>
  Effect.gen(function* () {
    const keyOf = tag[internal.keyOfSym];
    const partition: PartitionFn = options?.partition ?? consistentHash;
    const scopeKey = tag.key;
    const sql = yield* SqlClient;
    const seededUnknown = yield* shardMapSql
      .loadScope(sql, scopeKey)
      .pipe(Effect.orDie);
    // SAFE: SQL JSON hydrate is opaque; wire Schema validates at the RPC boundary (Telemetry has
    // no equivalent store — peer/Impl opacity is the same Mapped-under-Top story).
    const seeded = seededUnknown as Map<string, ValueT<Value>>;
    const store = yield* Ref.make(seeded);
    const peers = yield* Resource.peers(tag);
    const self = yield* Resource.selfNode(tag);

    const nodeKeys = (): ReadonlyArray<string> => {
      const declared = Resource.distributedOf(tag).map((n) => n.key);
      if (declared.length > 0) {
        return declared;
      }
      return [self, ...Object.keys(peers)];
    };

    // SAFE: PeerServiceOf does not reduce under Schema.Top Spec params (see Resource.peersLayer).
    const asPeerLeaf = (peer: unknown): PeerLeaf<Key, Value> =>
      peer as unknown as PeerLeaf<Key, Value>;

    const peerAt = (owner: string): PeerLeaf<Key, Value> | undefined => {
      const peer = peers[owner];
      return peer === undefined ? undefined : asPeerLeaf(peer);
    };

    const getLocal = (key: KeyT<Key>) =>
      Ref.get(store).pipe(
        Effect.map((m) => Option.fromNullishOr(m.get(internal.keyWire(key)))),
      );

    const putLocal = (value: ValueT<Value>) =>
      Effect.gen(function* () {
        const wire = internal.keyWire(keyOf(value));
        yield* shardMapSql.upsert(sql, scopeKey, wire, value).pipe(Effect.orDie);
        yield* Ref.update(store, (m) => {
          const next = new Map(m);
          next.set(wire, value);
          return next;
        });
      });

    const deleteLocal = (key: KeyT<Key>) =>
      Effect.gen(function* () {
        const wire = internal.keyWire(key);
        const had = yield* Ref.get(store).pipe(Effect.map((m) => m.has(wire)));
        if (!had) {
          return false;
        }
        yield* shardMapSql.deleteKey(sql, scopeKey, wire).pipe(Effect.orDie);
        yield* Ref.update(store, (m) => {
          const next = new Map(m);
          next.delete(wire);
          return next;
        });
        return true;
      });

    const sizeLocal = Ref.get(store).pipe(Effect.map((m) => m.size));

    const ownerOf = (key: KeyT<Key> | unknown): string =>
      partition(internal.keyWire(key), nodeKeys());

    const get = (key: KeyT<Key>) =>
      Effect.gen(function* () {
        const owner = ownerOf(key);
        if (owner === self) {
          return yield* getLocal(key);
        }
        const peer = peerAt(owner);
        if (peer === undefined) {
          return Option.none();
        }
        return yield* peer.getLocal(key);
      });

    const put = (value: ValueT<Value>) =>
      Effect.gen(function* () {
        const owner = ownerOf(keyOf(value));
        if (owner === self) {
          yield* putLocal(value);
          return true;
        }
        const peer = peerAt(owner);
        if (peer === undefined) {
          return false;
        }
        yield* peer.putLocal(value);
        return true;
      });

    const delete_ = (key: KeyT<Key>) =>
      Effect.gen(function* () {
        const owner = ownerOf(key);
        if (owner === self) {
          return yield* deleteLocal(key);
        }
        const peer = peerAt(owner);
        if (peer === undefined) {
          return false;
        }
        return yield* peer.deleteLocal(key);
      });

    return {
      get,
      put,
      delete: delete_,
      getLocal,
      putLocal,
      deleteLocal,
      sizeLocal,
      sizeByNode: Effect.gen(function* () {
        const byNode = yield* combineQuery(
          peers,
          (peer) => asPeerLeaf(peer).sizeLocal,
          Combine.byNode,
        );
        const own = yield* sizeLocal;
        return { ...byNode, [self]: own };
      }),
      size: Effect.gen(function* () {
        const others = yield* combineQuery(
          peers,
          (peer) => asPeerLeaf(peer).sizeLocal,
          Combine.sum,
        );
        return others + (yield* sizeLocal);
      }),
    };
  });

/**
 * Bridge concrete {@link ShardMapImpl} → {@link Resource.ImplOf}. ImplOf stays opaque under
 * Schema.Top Key/Value Method params (Telemetry avoids this via a concrete Spec const).
 *
 * @internal
 */
const asImpl = <
  Key extends Schema.Top,
  Value extends Schema.Top,
  Error extends Schema.Top,
>(
  impl: ShardMapImpl<Key, Value>,
): Resource.ImplOf<ShardMapSpecOf<Key, Value, Error>> =>
  // SAFE: handlers match get/put/delete/*/size* wire; ImplOf does not reduce under Schema.Top.
  impl as unknown as Resource.ImplOf<ShardMapSpecOf<Key, Value, Error>>;

/**
 * Bridge concrete {@link ShardMapImpl} → {@link Resource.ServeImplOf}.
 *
 * @internal
 */
const asServeImpl = <
  Key extends Schema.Top,
  Value extends Schema.Top,
  Error extends Schema.Top,
>(
  impl: ShardMapImpl<Key, Value>,
): Resource.ServeImplOf<ShardMapSpecOf<Key, Value, Error>, never> =>
  // SAFE: same Schema.Top ImplOf opacity as asImpl for the serve/serveRemote path.
  impl as unknown as Resource.ServeImplOf<ShardMapSpecOf<Key, Value, Error>, never>;

// ============================================================================
// Layer / serve
// ============================================================================

/**
 * Local layer — SQL-backed shard + routed/fleet members. Opens SQLite (`:memory:` by default;
 * override with `{ filename }`). Requires mesh discharge
 * ({@link Resource.peersLayer} or peersFrom + selfNodeLayer).
 *
 * @public
 */
export const layer = <
  Self,
  Key extends Schema.Top,
  Value extends Schema.Top,
  Error extends Schema.Top,
>(
  tag: ShardMapTag<Self, Key, Value, Error>,
  options?: ShardMapOptions,
): Layer.Layer<Self | Local<Self>, never, PeersId<Self> | SelfNodeId<Self>> =>
  withSqlite(
    options,
    buildImpl(tag, options).pipe(
      Effect.map((impl) => Resource.layer(tag, asImpl(impl))),
      Layer.unwrap,
    ),
  );

/**
 * Serve remotely (handlers only). Opens SQLite (`:memory:` by default). Requires mesh discharge.
 *
 * @public
 */
export const serveRemote = <
  Self,
  Key extends Schema.Top,
  Value extends Schema.Top,
  Error extends Schema.Top,
>(
  tag: ShardMapTag<Self, Key, Value, Error>,
  options?: ShardMapOptions,
) =>
  withSqlite(
    options,
    buildImpl(tag, options).pipe(
      Effect.map((impl) => Resource.serveRemote(tag, asServeImpl(impl))),
      Layer.unwrap,
    ),
  );

/**
 * Serve + grant local instance from one materialization. Opens SQLite (`:memory:` by default).
 *
 * @example
 * ShardMap.serve(Sessions).pipe(
 *   Layer.provide(Resource.peersLayer(Sessions, DropletEast)),
 * )
 *
 * // Durable file:
 * ShardMap.serve(Sessions, { filename: ".effect-pm/sessions.sqlite" })
 *
 * @public
 */
export const serve = <
  Self,
  Key extends Schema.Top,
  Value extends Schema.Top,
  Error extends Schema.Top,
>(
  tag: ShardMapTag<Self, Key, Value, Error>,
  options?: ShardMapOptions,
) =>
  withSqlite(
    options,
    Resource.serve(
      tag,
      buildImpl(tag, options).pipe(Effect.map((impl) => asImpl(impl))),
    ),
  );

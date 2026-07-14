/**
 * ShardMap — partitioned key/value Resource factory.
 *
 * One map across a fleet of nodes: declare `key` / `value` schemas, distribute across
 * `app/Droplet*` nodes, and every routed `get` / `put` / `delete` forwards to the owning
 * shard via {@link Resource.peers}. Leaf `*Local` ops stay on this node. Fleet folds report
 * shard sizes. An unreachable owner degrades to a miss — not a cascading health failure.
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
import { Effect, Layer, Schema } from "effect";
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

// ============================================================================
// Public constants + partition
// ============================================================================

/**
 * This contract's canonical kind (stamped on every tag; read via `Resource.kindOf`).
 *
 * @public
 * @since 1.0.0
 */
export const kind = "@nikscripts/effect-pm/ShardMap";

/**
 * Stable owner pick for a **fixed** node set — sort keys, then `Hash.string` modulo.
 * Remapping when membership changes is intentional / explicit (v1 = fixed fleet).
 *
 * @public
 * @since 1.0.0
 */
export const consistentHash = internal.consistentHash;

/**
 * Partition function — maps a wire key string onto a node key.
 *
 * @public
 * @since 1.0.0
 */
export type PartitionFn = internal.PartitionFn;

/**
 * Options for {@link layer} / {@link serve} / {@link serveRemote}.
 *
 * @public
 * @since 1.0.0
 */
export type ShardMapOptions = internal.ShardMapOptions;

// ============================================================================
// Spec builder
// ============================================================================

/**
 * Build a ShardMap instance spec from key/value (and optional error) schemas.
 *
 * @public
 * @since 1.0.0
 */
export const shardMapSpec = <
  Key extends Schema.Top,
  Value extends Schema.Top,
  Error extends Schema.Top = typeof Schema.Never,
>(schemas: {
  readonly key: Key;
  readonly value: Value;
  readonly error?: Error;
}) => {
  const error = (schemas.error ?? Schema.Never) as Error | typeof Schema.Never;
  const optionValue = Schema.Option(schemas.value);
  return {
    get: Resource.effectFn({
      payload: schemas.key,
      success: optionValue,
      error,
    }).annotate({
      description:
        "Value for `key` from whichever node owns the shard (miss if unreachable).",
    }),
    put: Resource.effectFn({
      payload: schemas.value,
      success: Schema.Boolean,
      error,
    }).annotate({
      description:
        "Upsert on the owning node (key via `keyOf`); `true` when written, `false` if owner unreachable.",
    }),
    delete: Resource.effectFn({
      payload: schemas.key,
      success: Schema.Boolean,
      error,
    }).annotate({
      description: "Delete on the owning node; `true` when an entry was removed.",
    }),
    getLocal: Resource.effectFn({
      payload: schemas.key,
      success: optionValue,
      error,
    }).annotate({
      description: "Read from this node's shard only (no forward).",
    }),
    putLocal: Resource.effectFn({
      payload: schemas.value,
      success: Schema.Void,
      error,
    }).annotate({
      description: "Write into this node's shard only (no forward).",
    }),
    deleteLocal: Resource.effectFn({
      payload: schemas.key,
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
 * Spec produced by {@link shardMapSpec}.
 *
 * @public
 * @since 1.0.0
 */
export type ShardMapSpecOf<
  Key extends Schema.Top,
  Value extends Schema.Top,
  Error extends Schema.Top = typeof Schema.Never,
> = ReturnType<typeof shardMapSpec<Key, Value, Error>>;

// ============================================================================
// Tag
// ============================================================================

/**
 * A ShardMap instance tag.
 *
 * @public
 * @since 1.0.0
 */
export type ShardMapTag<
  Self,
  Key extends Schema.Top,
  Value extends Schema.Top,
  Error extends Schema.Top = typeof Schema.Never,
> = ResourceTag<Self, ShardMapSpecOf<Key, Value, Error>> & {
  readonly [internal.keySchemaSym]: Key;
  readonly [internal.keyOfSym]: (
    value: Schema.Schema.Type<Value>,
  ) => Schema.Schema.Type<Key>;
};

/**
 * A node-bound {@link ShardMapTag}.
 *
 * @public
 * @since 1.0.0
 */
export type ShardMapNodeTag<
  Self,
  HSelf,
  Key extends Schema.Top,
  Value extends Schema.Top,
  Error extends Schema.Top = typeof Schema.Never,
> = NodeBoundTag<Self, ShardMapSpecOf<Key, Value, Error>, HSelf> & {
  readonly [internal.keySchemaSym]: Key;
  readonly [internal.keyOfSym]: (
    value: Schema.Schema.Type<Value>,
  ) => Schema.Schema.Type<Key>;
};

/**
 * Tag-construction schemas + `keyOf` for routed `put`.
 *
 * @public
 * @since 1.0.0
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
 * @since 1.0.0
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
    const spec = shardMapSpec({
      key: schemas.key,
      value: schemas.value,
      error: schemas.error,
    });
    const tag = (
      schemas.node === undefined
        ? resourceTag<Self>()(key, spec, {
            kind,
            description: schemas.description,
          })
        : resourceTag<Self>()(key, spec, {
            kind,
            description: schemas.description,
            node: schemas.node,
          })
    ) as ShardMapTag<Self, Key, Value, Error>;
    return Object.assign(tag, {
      [internal.keySchemaSym]: schemas.key,
      [internal.keyOfSym]: schemas.keyOf,
    });
  };

// ============================================================================
// Layer / serve
// ============================================================================

/**
 * Local layer — in-memory shard + routed/fleet members. Requires mesh discharge
 * ({@link Resource.peersLayer} or peersFrom + selfNodeLayer).
 *
 * @public
 * @since 1.0.0
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
  Layer.unwrap(
    Effect.map(
      internal.buildImpl(tag as unknown as internal.EngineTag, options),
      (impl) =>
        Resource.layer(
          tag,
          impl as unknown as Resource.ImplOf<ShardMapSpecOf<Key, Value, Error>>,
        ),
    ),
  ) as Layer.Layer<Self | Local<Self>, never, PeersId<Self> | SelfNodeId<Self>>;

/**
 * Serve remotely (handlers only). Requires mesh discharge.
 *
 * @public
 * @since 1.0.0
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
  Layer.unwrap(
    Effect.map(
      internal.buildImpl(tag as unknown as internal.EngineTag, options),
      (impl) =>
        Resource.serveRemote(
          tag,
          impl as unknown as Resource.ServeImplOf<
            ShardMapSpecOf<Key, Value, Error>,
            never
          >,
        ),
    ),
  );

/**
 * Serve + grant local instance from one materialization.
 *
 * @example
 * ShardMap.serve(Sessions).pipe(
 *   Layer.provide(Resource.peersLayer(Sessions, DropletEast)),
 * )
 *
 * @public
 * @since 1.0.0
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
  Resource.serve(
    tag,
    internal.buildImpl(tag as unknown as internal.EngineTag, options) as Effect.Effect<
      Resource.ImplOf<ShardMapSpecOf<Key, Value, Error>>,
      never,
      PeersId<Self> | SelfNodeId<Self>
    >,
  );

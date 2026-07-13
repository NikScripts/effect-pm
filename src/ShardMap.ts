/**
 * ShardMap — partitioned key/value Resource factory.
 *
 * One map across a fleet of nodes: declare `key` / `value` schemas, distribute across
 * `app/Droplet*` nodes, and every routed `get` / `put` / `delete` forwards to the owning
 * shard via {@link Resource.peers}. Leaf `*Local` ops stay on this node. Fleet folds report
 * shard sizes. An unreachable owner degrades to a miss — not a cascading health failure.
 *
 * @module ShardMap
 */
import { Effect, Hash, Layer, Option, Ref, Schema, Scope } from "effect";
import { Combine, combineQuery } from "./MultiNode";
import * as Resource from "./Resource";
import {
  Tag as resourceTag,
  type AnyNode,
  type Local,
  type NodeBoundTag,
  type NodeKey,
  type PeersId,
  type ResourceTag,
  type SelfNodeId,
  type Spec,
} from "./Resource";

// ============================================================================
// Public constants + partition
// ============================================================================

/** This contract's canonical kind (stamped on every tag; read via `Resource.kindOf`). @public */
export const kind = "@nikscripts/effect-pm/ShardMap";

/**
 * Stable owner pick for a **fixed** node set — sort keys, then `Hash.string` modulo.
 * Remapping when membership changes is intentional / explicit (v1 = fixed fleet).
 *
 * @public
 */
export const consistentHash = (
  key: string,
  nodes: ReadonlyArray<string>,
): string => {
  if (nodes.length === 0) {
    return "";
  }
  const sorted = [...nodes].sort();
  const h = Hash.string(key);
  const idx = ((h % sorted.length) + sorted.length) % sorted.length;
  return sorted[idx]!;
};

/** Encode a decoded key to a stable string for Map storage + partition. @internal */
const keyWire = (key: unknown): string => {
  if (typeof key === "string") {
    return key;
  }
  if (
    typeof key === "number" ||
    typeof key === "boolean" ||
    typeof key === "bigint"
  ) {
    return String(key);
  }
  return Schema.encodeSync(Schema.UnknownFromJsonString)(key);
};

/** Same `Symbol.for` key Resource uses for `distributed` (not re-exported). @internal */
const distributedSym = Symbol.for("@nikscripts/effect-pm/Resource/distributed");

/** Read the tag's distributed node set (empty when undeclared). @internal */
const distributedNodes = <Self, S extends Spec>(
  tag: ResourceTag<Self, S>,
): ReadonlyArray<AnyNode> => {
  const nodes = (tag as ResourceTag<Self, S> & {
    readonly [distributedSym]?: ReadonlyArray<AnyNode>;
  })[distributedSym];
  return nodes ?? [];
};

// ============================================================================
// Spec builder
// ============================================================================

/**
 * Build a ShardMap instance spec from key/value (and optional error) schemas.
 *
 * @public
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

/** @internal */
export type ShardMapSpecOf<
  Key extends Schema.Top,
  Value extends Schema.Top,
  Error extends Schema.Top = typeof Schema.Never,
> = ReturnType<typeof shardMapSpec<Key, Value, Error>>;

// ============================================================================
// Tag
// ============================================================================

const keySchemaSym: unique symbol = Symbol.for(
  "@nikscripts/effect-pm/ShardMap/keySchema",
);
const valueSchemaSym: unique symbol = Symbol.for(
  "@nikscripts/effect-pm/ShardMap/valueSchema",
);
const keyOfSym: unique symbol = Symbol.for("@nikscripts/effect-pm/ShardMap/keyOf");

/** A ShardMap instance tag. @public */
export type ShardMapTag<
  Self,
  Key extends Schema.Top,
  Value extends Schema.Top,
  Error extends Schema.Top = typeof Schema.Never,
> = ResourceTag<Self, ShardMapSpecOf<Key, Value, Error>> & {
  readonly [keySchemaSym]: Key;
  readonly [valueSchemaSym]: Value;
  readonly [keyOfSym]: (
    value: Schema.Schema.Type<Value>,
  ) => Schema.Schema.Type<Key>;
};

/** A node-bound {@link ShardMapTag}. @public */
export type ShardMapNodeTag<
  Self,
  HSelf,
  Key extends Schema.Top,
  Value extends Schema.Top,
  Error extends Schema.Top = typeof Schema.Never,
> = NodeBoundTag<Self, ShardMapSpecOf<Key, Value, Error>, HSelf> & {
  readonly [keySchemaSym]: Key;
  readonly [valueSchemaSym]: Value;
  readonly [keyOfSym]: (
    value: Schema.Schema.Type<Value>,
  ) => Schema.Schema.Type<Key>;
};

/** Tag-construction schemas + `keyOf` for routed `put`. @public */
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
 * ```ts
 * class Sessions extends ShardMap.Tag<Sessions>()("app/Sessions", {
 *   key: SessionId,
 *   value: Session,
 *   keyOf: (s) => s.id,
 * }).pipe(Resource.distributed([DropletEast, DropletWest])) {}
 * ```
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
      [keySchemaSym]: schemas.key,
      [valueSchemaSym]: schemas.value,
      [keyOfSym]: schemas.keyOf,
    });
  };

// ============================================================================
// Engine
// ============================================================================

/** Partition function — maps a wire key string onto a node key. @public */
export type PartitionFn = (
  key: string,
  nodes: ReadonlyArray<string>,
) => string;

/** Options for {@link layer} / {@link serve} / {@link serveRemote}. @public */
export interface ShardMapOptions {
  /** Owner pick for a key. @default {@link consistentHash} */
  readonly partition?: PartitionFn;
}

/**
 * Build the in-memory shard + routed/fleet members. Requires {@link Resource.peers} /
 * {@link Resource.selfNode} (discharge with {@link Resource.peersLayer}).
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
  Resource.ImplOf<ShardMapSpecOf<Key, Value, Error>>,
  never,
  Scope.Scope | PeersId<Self> | SelfNodeId<Self>
> =>
  Effect.gen(function* () {
    type K = Schema.Schema.Type<Key>;
    type V = Schema.Schema.Type<Value>;
    const keyOf = tag[keyOfSym] as (value: V) => K;
    const partition = options?.partition ?? consistentHash;
    const store = yield* Ref.make(new Map<string, V>());
    const peers = yield* Resource.peers(tag);
    const self = yield* Resource.selfNode(tag);

    /** Prefer the tag's declared fleet (fixed membership); fall back to live mesh keys. */
    const nodeKeys = (): ReadonlyArray<string> => {
      const declared = distributedNodes(tag).map((n) => n.key);
      if (declared.length > 0) {
        return declared;
      }
      return [self, ...Object.keys(peers)];
    };

    /** Peer leaf surface — folded / forwarded (not fleet, not routed fan-out). */
    type PeerLeaf = {
      readonly getLocal: (key: K) => Effect.Effect<Option.Option<V>>;
      readonly putLocal: (value: V) => Effect.Effect<void>;
      readonly deleteLocal: (key: K) => Effect.Effect<boolean>;
      readonly sizeLocal: Effect.Effect<number>;
    };
    const peerAt = (owner: string): PeerLeaf | undefined => {
      const peer = peers[owner];
      return peer === undefined ? undefined : (peer as unknown as PeerLeaf);
    };

    const getLocal = (key: K) =>
      Ref.get(store).pipe(
        Effect.map((m) => Option.fromNullishOr(m.get(keyWire(key)))),
      );

    const putLocal = (value: V) =>
      Ref.update(store, (m) => {
        const next = new Map(m);
        next.set(keyWire(keyOf(value)), value);
        return next;
      });

    const deleteLocal = (key: K) =>
      Ref.modify(store, (m) => {
        const wire = keyWire(key);
        const had = m.has(wire);
        if (!had) {
          return [false, m] as const;
        }
        const next = new Map(m);
        next.delete(wire);
        return [true, next] as const;
      });

    const sizeLocal = Ref.get(store).pipe(Effect.map((m) => m.size));

    const ownerOf = (key: K): string => partition(keyWire(key), nodeKeys());

    const get = (key: K) =>
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

    const put = (value: V) =>
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

    const delete_ = (key: K) =>
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
          (peer) => (peer as unknown as PeerLeaf).sizeLocal,
          Combine.byNode,
        );
        const own = yield* sizeLocal;
        return { ...byNode, [self]: own };
      }),
      size: Effect.gen(function* () {
        const others = yield* combineQuery(
          peers,
          (peer) => (peer as unknown as PeerLeaf).sizeLocal,
          Combine.sum,
        );
        return others + (yield* sizeLocal);
      }),
    } as unknown as Resource.ImplOf<ShardMapSpecOf<Key, Value, Error>>;
  });

/**
 * Local layer — in-memory shard + routed/fleet members. Requires mesh discharge
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
  Layer.unwrap(
    Effect.map(buildImpl(tag, options), (impl) => Resource.layer(tag, impl)),
  );

/**
 * Serve remotely (handlers only). Requires mesh discharge.
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
  Layer.unwrap(
    Effect.map(buildImpl(tag, options), (impl) =>
      Resource.serveRemote(tag, impl),
    ),
  );

/**
 * Serve + grant local instance from one materialization.
 *
 * ```ts
 * ShardMap.serve(Sessions).pipe(
 *   Layer.provide(Resource.peersLayer(Sessions, DropletEast)),
 * )
 * ```
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
) => Resource.serve(tag, buildImpl(tag, options));

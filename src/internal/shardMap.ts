/**
 * ShardMap engine — in-memory shard, partition helpers, and routed/fleet members.
 *
 * When {@link Storage} is in context (toolkit layers merge {@link Store.layerDefaultMemory}),
 * the shard is hydrated from persisted Put/Delete events and every local mutation appends.
 *
 * @internal
 */
import { Clock, Effect, Hash, Option, Ref, Schema, Scope } from "effect";
import { Combine, combineQuery } from "../MultiNode";
import * as Resource from "../Resource";
import type { PeersId, ResourceTag, SelfNodeId } from "../Resource";
import type { Storage } from "../Store";
import {
  foldShardMapEntries,
  materializeEngineShardMapStore,
  type ShardMapEntryEvent,
  type ShardMapStoreTag,
} from "./store/shardMapStoreSpec";
import {
  keyOfSym,
  keySchemaSym,
  valueSchemaSym,
} from "./shardMapSymbols";

export { keyOfSym, keySchemaSym, valueSchemaSym };

/** Partition function — maps a wire key string onto a node key. */
export type PartitionFn = (
  key: string,
  nodes: ReadonlyArray<string>,
) => string;

/** Options for layer / serve / serveRemote. */
export interface ShardMapOptions {
  /** Owner pick for a key. @default {@link consistentHash} */
  readonly partition?: PartitionFn;
}

/**
 * Stable owner pick for a **fixed** node set — sort keys, then `Hash.string` modulo.
 * Remapping when membership changes is intentional / explicit (v1 = fixed fleet).
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

/** Encode a decoded key to a stable string for Map storage + partition. */
export const keyWire = (key: unknown): string => {
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

/** Tag surface the engine needs — structural only; Spec depth erased at the boundary. */
export type EngineTag = {
  readonly [keyOfSym]: (value: never) => unknown;
  readonly [valueSchemaSym]: Schema.Top;
} & ResourceTag<unknown, Resource.Spec> &
  ShardMapStoreTag;

/**
 * Build the in-memory shard + routed/fleet members. Requires {@link Resource.peers} /
 * {@link Resource.selfNode} (discharge with {@link Resource.peersLayer}) and {@link Storage}
 * (toolkit layers merge the default memory bridge).
 *
 * Impl typing is erased here (boundary with the public {@link Resource.ImplOf} generics);
 * {@link Resource.layer} / {@link Resource.serve} re-constrain at the call site.
 */
export const buildImpl = (
  tag: EngineTag,
  options?: ShardMapOptions,
): Effect.Effect<
  Record<string, unknown>,
  never,
  Scope.Scope | PeersId<unknown> | SelfNodeId<unknown> | Storage
> =>
  Effect.gen(function* () {
    const keyOf = tag[keyOfSym] as (value: unknown) => unknown;
    const partition: PartitionFn = options?.partition ?? consistentHash;
    const persistence = yield* materializeEngineShardMapStore(tag);
    const seeded = foldShardMapEntries(
      (yield* persistence.events()) as ReadonlyArray<ShardMapEntryEvent>,
    );
    const store = yield* Ref.make(seeded);
    const peers = yield* Resource.peers(tag as ResourceTag<unknown, Resource.Spec>);
    const self = yield* Resource.selfNode(tag as ResourceTag<unknown, Resource.Spec>);

    // Prefer the tag's declared fleet (fixed membership); fall back to live mesh keys.
    const nodeKeys = (): ReadonlyArray<string> => {
      const declared = Resource.distributedOf(
        tag as ResourceTag<unknown, Resource.Spec>,
      ).map((n) => n.key);
      if (declared.length > 0) {
        return declared;
      }
      return [self, ...Object.keys(peers)];
    };

    type PeerLeaf = {
      readonly getLocal: (key: unknown) => Effect.Effect<Option.Option<unknown>>;
      readonly putLocal: (value: unknown) => Effect.Effect<void>;
      readonly deleteLocal: (key: unknown) => Effect.Effect<boolean>;
      readonly sizeLocal: Effect.Effect<number>;
    };
    const peerAt = (owner: string): PeerLeaf | undefined => {
      const peer = peers[owner];
      return peer === undefined ? undefined : (peer as unknown as PeerLeaf);
    };

    const getLocal = (key: unknown) =>
      Ref.get(store).pipe(
        Effect.map((m) => Option.fromNullishOr(m.get(keyWire(key)))),
      );

    const putLocal = (value: unknown) =>
      Effect.gen(function* () {
        const wire = keyWire(keyOf(value));
        const at = yield* Clock.currentTimeMillis;
        yield* persistence.record({
          _tag: "Put",
          key: wire,
          value,
          at,
        });
        yield* Ref.update(store, (m) => {
          const next = new Map(m);
          next.set(wire, value);
          return next;
        });
      });

    const deleteLocal = (key: unknown) =>
      Effect.gen(function* () {
        const wire = keyWire(key);
        const had = yield* Ref.get(store).pipe(Effect.map((m) => m.has(wire)));
        if (!had) {
          return false;
        }
        const at = yield* Clock.currentTimeMillis;
        yield* persistence.record({
          _tag: "Delete",
          key: wire,
          at,
        });
        yield* Ref.update(store, (m) => {
          const next = new Map(m);
          next.delete(wire);
          return next;
        });
        return true;
      });

    const sizeLocal = Ref.get(store).pipe(Effect.map((m) => m.size));

    const ownerOf = (key: unknown): string =>
      partition(keyWire(key), nodeKeys());

    const get = (key: unknown) =>
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

    const put = (value: unknown) =>
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

    const delete_ = (key: unknown) =>
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
    };
  });

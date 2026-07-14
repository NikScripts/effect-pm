/**
 * ShardMap helpers — partition, key wire encoding, options, schema stamps.
 *
 * The RPC engine (`buildImpl`) lives in `ShardMap.ts` (Telemetry posture): generic over the
 * public Tag so `Resource.peers` / `selfNode` stay typed. This module stays tag-agnostic.
 *
 * @internal
 */
import { Hash, Schema } from "effect";
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
  /**
   * SQLite filename for this shard's SSOT. Default `:memory:` (in-process, always on).
   * Pass a path for crash-surviving durability.
   */
  readonly filename?: string;
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

/**
 * ShardMap tag stamp symbols — shared by the engine and store contract without a cycle.
 *
 * @module internal/shardMapSymbols
 * @internal
 */

/** Stamped on every ShardMap tag — the key schema. */
export const keySchemaSym: unique symbol = Symbol.for(
  "@nikscripts/effect-pm/ShardMap/keySchema",
);

/** Stamped on every ShardMap tag — the value schema (store codec). */
export const valueSchemaSym: unique symbol = Symbol.for(
  "@nikscripts/effect-pm/ShardMap/valueSchema",
);

/** Stamped on every ShardMap tag — extract partition key from a value. */
export const keyOfSym: unique symbol = Symbol.for(
  "@nikscripts/effect-pm/ShardMap/keyOf",
);

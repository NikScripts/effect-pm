/**
 * ShardMap tag stamp symbols — Key / Value / keyOf carriers on the Resource tag without
 * importing the public module (avoids a cycle with the engine).
 *
 * @module shardMapSymbols
 * @internal
 */

/** Stamped on every ShardMap tag — the key schema. @internal */
export const keySchemaSym: unique symbol = Symbol.for(
  "@nikscripts/effect-pm/ShardMap/keySchema",
);

/** Stamped on every ShardMap tag — the value schema. @internal */
export const valueSchemaSym: unique symbol = Symbol.for(
  "@nikscripts/effect-pm/ShardMap/valueSchema",
);

/** Stamped on every ShardMap tag — extract partition key from a value. @internal */
export const keyOfSym: unique symbol = Symbol.for(
  "@nikscripts/effect-pm/ShardMap/keyOf",
);

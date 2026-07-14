/**
 * Drizzle-RQB-style nested `where` filters for Store shape reads.
 *
 * @module internal/store/where
 * @internal
 */

import { Schema } from "effect";
import { isRecord } from "../json";

/** Shared baked-in read payload fields (every shape). @internal */
export const storeReadPayloadSchema = Schema.Struct({
  limit: Schema.optional(Schema.Number),
  before: Schema.optional(Schema.Number),
  after: Schema.optional(Schema.Number),
  where: Schema.optional(Schema.Unknown),
});

/** @internal */
export type StoreReadPayloadFields = typeof storeReadPayloadSchema.Type;

/** Comparison / null / array operators on a leaf value (Drizzle RQB column ops). @internal */
export type WhereOperators<T> = {
  readonly eq?: T;
  readonly ne?: T;
  readonly gt?: T;
  readonly gte?: T;
  readonly lt?: T;
  readonly lte?: T;
  readonly in?: ReadonlyArray<T>;
  readonly notIn?: ReadonlyArray<T>;
  readonly like?: string;
  readonly ilike?: string;
  readonly notLike?: string;
  readonly notIlike?: string;
  readonly isNull?: boolean;
  readonly isNotNull?: boolean;
  readonly arrayContains?: T extends ReadonlyArray<infer U> ? ReadonlyArray<U> : ReadonlyArray<unknown>;
  readonly arrayContained?: T extends ReadonlyArray<infer U> ? ReadonlyArray<U> : ReadonlyArray<unknown>;
  readonly arrayOverlaps?: T extends ReadonlyArray<infer U> ? ReadonlyArray<U> : ReadonlyArray<unknown>;
};

type Primitive = string | number | boolean | bigint | null | undefined;

/** One field clause: shorthand eq, operator object, or nested where for objects. @internal */
export type WhereField<T> = [T] extends [Primitive]
  ? T | WhereOperators<T>
  : [T] extends [ReadonlyArray<infer _U>]
    ? T | WhereOperators<T>
    : [T] extends [object]
      ? WhereFilter<T> | WhereOperators<T> | T
      : T | WhereOperators<T>;

/** Nested RQB `where` filter typed from a decoded row. @internal */
export type WhereFilter<Row> = {
  readonly [K in keyof Row]?: WhereField<Row[K]>;
} & {
  readonly AND?: ReadonlyArray<WhereFilter<Row>>;
  readonly OR?: ReadonlyArray<WhereFilter<Row>>;
  readonly NOT?: WhereFilter<Row>;
};

/** Baked-in read argument for `store.<shape>.read`. @internal */
export type StoreReadPayload<Row> = {
  readonly limit?: number;
  readonly before?: number;
  readonly after?: number;
  readonly where?: WhereFilter<Row>;
};

const OPERATOR_KEYS = new Set([
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "notIn",
  "like",
  "ilike",
  "notLike",
  "notIlike",
  "isNull",
  "isNotNull",
  "arrayContains",
  "arrayContained",
  "arrayOverlaps",
]);

const LOGICAL_KEYS = new Set(["AND", "OR", "NOT"]);

const isOperatorObject = (value: unknown): value is Record<string, unknown> => {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => OPERATOR_KEYS.has(key));
};

const likeMatch = (value: unknown, pattern: string, insensitive: boolean): boolean => {
  if (typeof value !== "string") return false;
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regexSource = `^${escaped.replace(/%/g, ".*").replace(/_/g, ".")}$`;
  return new RegExp(regexSource, insensitive ? "i" : undefined).test(value);
};

const compareOrdered = (left: unknown, right: unknown): number | undefined => {
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "string" && typeof right === "string") {
    return left < right ? -1 : left > right ? 1 : 0;
  }
  if (typeof left === "bigint" && typeof right === "bigint") {
    return left < right ? -1 : left > right ? 1 : 0;
  }
  if (left instanceof Date && right instanceof Date) {
    return left.getTime() - right.getTime();
  }
  return undefined;
};

const matchOperators = (value: unknown, ops: Record<string, unknown>): boolean => {
  if ("eq" in ops && !Object.is(value, ops.eq)) return false;
  if ("ne" in ops && Object.is(value, ops.ne)) return false;
  if ("gt" in ops) {
    const cmp = compareOrdered(value, ops.gt);
    if (cmp === undefined || cmp <= 0) return false;
  }
  if ("gte" in ops) {
    const cmp = compareOrdered(value, ops.gte);
    if (cmp === undefined || cmp < 0) return false;
  }
  if ("lt" in ops) {
    const cmp = compareOrdered(value, ops.lt);
    if (cmp === undefined || cmp >= 0) return false;
  }
  if ("lte" in ops) {
    const cmp = compareOrdered(value, ops.lte);
    if (cmp === undefined || cmp > 0) return false;
  }
  if ("in" in ops) {
    const list = ops.in;
    if (!Array.isArray(list) || !list.some((item) => Object.is(item, value))) return false;
  }
  if ("notIn" in ops) {
    const list = ops.notIn;
    if (!Array.isArray(list) || list.some((item) => Object.is(item, value))) return false;
  }
  if ("like" in ops) {
    if (typeof ops.like !== "string" || !likeMatch(value, ops.like, false)) return false;
  }
  if ("ilike" in ops) {
    if (typeof ops.ilike !== "string" || !likeMatch(value, ops.ilike, true)) return false;
  }
  if ("notLike" in ops) {
    if (typeof ops.notLike !== "string" || likeMatch(value, ops.notLike, false)) return false;
  }
  if ("notIlike" in ops) {
    if (typeof ops.notIlike !== "string" || likeMatch(value, ops.notIlike, true)) return false;
  }
  if ("isNull" in ops) {
    if (ops.isNull === true && value !== null && value !== undefined) return false;
    if (ops.isNull === false && (value === null || value === undefined)) return false;
  }
  if ("isNotNull" in ops) {
    if (ops.isNotNull === true && (value === null || value === undefined)) return false;
    if (ops.isNotNull === false && value !== null && value !== undefined) return false;
  }
  if ("arrayContains" in ops) {
    if (!Array.isArray(value) || !Array.isArray(ops.arrayContains)) return false;
    if (!ops.arrayContains.every((item) => value.some((v) => Object.is(v, item)))) return false;
  }
  if ("arrayContained" in ops) {
    const needle = ops.arrayContained;
    if (!Array.isArray(value) || !Array.isArray(needle)) return false;
    if (!value.every((item) => needle.some((v) => Object.is(v, item)))) return false;
  }
  if ("arrayOverlaps" in ops) {
    const needle = ops.arrayOverlaps;
    if (!Array.isArray(value) || !Array.isArray(needle)) return false;
    if (!needle.some((item) => value.some((v) => Object.is(v, item)))) return false;
  }
  return true;
};

const matchField = (value: unknown, clause: unknown): boolean => {
  if (clause === undefined) return true;
  if (isOperatorObject(clause)) return matchOperators(value, clause);
  if (isRecord(clause) && isRecord(value)) return matchWhere(value, clause);
  return Object.is(value, clause);
};

/**
 * Evaluate a Drizzle-RQB-style `where` against a decoded row.
 *
 * @internal
 */
export const matchWhere = (row: unknown, where: unknown): boolean => {
  if (where === undefined || where === null) return true;
  if (!isRecord(where)) return false;

  if ("AND" in where) {
    const parts = where.AND;
    if (!Array.isArray(parts) || !parts.every((part) => matchWhere(row, part))) return false;
  }
  if ("OR" in where) {
    const parts = where.OR;
    if (!Array.isArray(parts) || parts.length === 0 || !parts.some((part) => matchWhere(row, part))) {
      return false;
    }
  }
  if ("NOT" in where) {
    if (matchWhere(row, where.NOT)) return false;
  }

  if (!isRecord(row)) {
    // Only logical keys allowed when the row itself is not a record.
    return Object.keys(where).every((key) => LOGICAL_KEYS.has(key));
  }

  for (const [key, clause] of Object.entries(where)) {
    if (LOGICAL_KEYS.has(key)) continue;
    if (!matchField(row[key], clause)) return false;
  }
  return true;
};

/**
 * Keep rows whose decoded payload matches `where` (no-op when `where` is absent).
 *
 * @internal
 */
export const filterRowsByWhere = <T>(
  rows: ReadonlyArray<T>,
  where: unknown,
  getPayload: (row: T) => unknown,
): ReadonlyArray<T> => {
  if (where === undefined || where === null) return rows;
  return rows.filter((row) => matchWhere(getPayload(row), where));
};

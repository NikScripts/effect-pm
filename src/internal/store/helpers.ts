/**
 * Type-agnostic helpers shared by store facets and journal codecs.
 *
 * @module internal/store/helpers
 * @internal
 */

import { isRecord, type JsonValue } from "../json";

export {
  dateFromMillis,
  dateFromUnknown,
  epochMillisFromUnknown,
  isBoolean,
  isFiniteNumber,
  isJsonValue,
  isRecord,
  isString,
} from "../json";

/**
 * Pagination / time window for historical reads.
 *
 * @internal
 */
export interface QueryOpts {
  /** Maximum number of rows to return. */
  limit?: number;
  /** Filter: only events before this epoch millis. */
  before?: number;
  /** Filter: only events after this epoch millis. */
  after?: number;
}

/**
 * Decode an arbitrary JSON-ish value into a record-shaped object suitable
 * for public `attributes` fields.
 *
 * @remarks
 * Returns `undefined` when the input is absent or is not a JSON object.
 * Non-record values (string, array, primitive, undefined, null) intentionally
 * collapse to `undefined` rather than fabricating a `{ value }` wrapper.
 *
 * @internal
 */
export const recordAttributesObject = (
  attributes: unknown,
): Record<string, unknown> | undefined => {
  if (!isRecord(attributes)) return undefined;
  const out: { [key: string]: unknown } = {};
  for (const [key, value] of Object.entries(attributes)) {
    out[key] = value;
  }
  return out;
};

/**
 * Coerce an arbitrary value into a {@link JsonValue}.
 *
 * @remarks
 * Used by row codecs to serialize `Record<string, unknown>` blobs: `Date` → ISO
 * string, primitives passed through, arrays / records walked recursively,
 * anything else collapsed to `null`.
 *
 * @internal
 */
export const toJsonValue = (value: unknown): JsonValue => {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (isRecord(value)) {
    const out: { [key: string]: JsonValue } = {};
    for (const [key, item] of Object.entries(value)) {
      // Drop `undefined`-valued keys (JSON semantics). Encoding them as `null` would break decode
      // for `Schema.optional(X)` fields (they expect `X | undefined`, not `null`) after the journal
      // round-trip — e.g. a queue entry's absent `key`.
      if (item === undefined) continue;
      out[key] = toJsonValue(item);
    }
    return out;
  }
  return null;
};

/**
 * Extract {@link QueryOpts} fields present on a decoded read payload.
 *
 * @internal
 */
export const queryOptsFromReadPayload = (
  payload: unknown,
): QueryOpts | undefined => {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }
  const record = payload as {
    readonly limit?: unknown;
    readonly before?: unknown;
    readonly after?: unknown;
  };
  const opts: QueryOpts = {};
  if (typeof record.limit === "number") {
    opts.limit = record.limit;
  }
  if (typeof record.before === "number") {
    opts.before = record.before;
  }
  if (typeof record.after === "number") {
    opts.after = record.after;
  }
  return opts.limit === undefined && opts.before === undefined && opts.after === undefined
    ? undefined
    : opts;
};

/**
 * Strip `limit` from {@link QueryOpts} while preserving the `before` /
 * `after` time window.
 *
 * @internal
 */
export const windowOpts = (
  opts: QueryOpts | undefined,
): QueryOpts | undefined => {
  if (opts === undefined) return undefined;
  const out: { -readonly [K in keyof QueryOpts]: QueryOpts[K] } = {};
  if (opts.before !== undefined) out.before = opts.before;
  if (opts.after !== undefined) out.after = opts.after;
  return out;
};

/**
 * Apply a `before` / `after` time window and `limit` to a sorted row list.
 *
 * @internal
 */
export const applyQueryOpts = <T>(
  rows: readonly T[],
  opts: QueryOpts | undefined,
  getTimestamp: (row: T) => number,
): T[] => {
  const filtered = rows.filter((row) => {
    const timestamp = getTimestamp(row);
    if (opts?.before !== undefined && timestamp >= opts.before) {
      return false;
    }
    if (opts?.after !== undefined && timestamp <= opts.after) {
      return false;
    }
    return true;
  });

  if (opts?.limit === undefined) {
    return filtered;
  }

  return filtered.slice(0, Math.max(0, opts.limit));
};

/**
 * Sort comparator: timestamp descending with deterministic tiebreaker.
 *
 * @internal
 */
export const byTimestampDesc =
  <T>(getTimestamp: (row: T) => number, getId?: (row: T) => string) =>
  (a: T, b: T) => {
    const byTime = getTimestamp(b) - getTimestamp(a);
    if (byTime !== 0) return byTime;
    if (getId === undefined) return 0;
    return getId(b).localeCompare(getId(a));
  };

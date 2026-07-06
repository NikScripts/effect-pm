/**
 * Type-agnostic helpers shared by every storage facet.
 *
 * @remarks
 * Strict invariant: nothing in this module knows about a specific facet's
 * wire-event vocabulary. Every export here is parametric over the row type
 * or operates on `RuntimeRecordPredicate` / `QueryOpts` / `RuntimeStorageError`.
 *
 * @module internal/store/helpers
 * @internal
 */

import { Cause, DateTime, Effect } from "effect";
import { And, Occurred } from "../../Query";
import type {
  RuntimeRecordPredicate,
  RuntimeRecordQuery,
} from "../../Query";
import type { JsonValue, QueryOpts } from "../../ProcessStoreEvent";
import {
  ProcessStoreDuplicateRecordError,
  ProcessStoreReadonlyRecordError,
  ProcessStoreStorageError,
  type ProcessStoreWriteError,
} from "../../ProcessStoreEvent";
import {
  RuntimeStorageDuplicateRecordError,
  RuntimeStorageReadonlyRecordError,
  type RuntimeStorageError,
} from "../../RuntimeStorage";
import { isRecord } from "../json";

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
 * Decode an arbitrary JSON-ish value into a record-shaped object suitable
 * for the public `AnalyticsEventBase.attributes` field.
 *
 * @remarks
 * Returns `undefined` when the input is absent or is not a JSON object.
 * Non-record values (string, array, primitive, undefined, null) intentionally
 * collapse to `undefined` rather than fabricating a `{ value }` wrapper, so
 * facets that share this helper produce a stable attributes shape on read.
 * Accepts `unknown` so per-facet decoders can pass nested payload sub-fields
 * without a cast.
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
 * Used by per-facet row codecs to serialize `Record<string, unknown>` blobs
 * (typically a fact / change `attributes` field): `Date` → ISO string,
 * primitives passed through, arrays / records walked recursively, anything
 * else (functions, symbols, class instances, etc.) collapsed to `null`.
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
 * @remarks
 * Use this when the storage query returns a strict superset of the final
 * projection (e.g. you fetch every row of a wire type and then post-filter
 * by an `attributes` field that storage cannot push down). The time window
 * narrows the read, but `limit` must be applied to the projected result —
 * not the broader stream — to match the expectation that "give me the last
 * N items matching the post-filter" actually returns N items, not N pre-
 * filter items that may collapse to zero after filtering.
 *
 * Returns `undefined` when the input is `undefined`. Returns an empty
 * object when the input only carried `limit`, so callers can pass the
 * result through unchanged to {@link runtimeRecordQuery}.
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
 * @remarks
 * When two rows share an `occurredAt` (common at millisecond resolution)
 * the optional `getId` projection produces a stable secondary key so the
 * surface order matches across runs and across adapters (memory + sqlite).
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

let inMemoryProcessStoreRunCounter = 0;

/**
 * Mint a unique `runId` for a freshly composed facet layer.
 *
 * @internal
 */
export const makeRunId = (now: number): string => {
  inMemoryProcessStoreRunCounter += 1;
  return `run-${String(now)}-${String(inMemoryProcessStoreRunCounter)}`;
};

/**
 * Map a {@link RuntimeStorageError} into the public
 * {@link ProcessStoreWriteError} channel.
 *
 * @internal
 */
export const processStoreWriteErrorFromRuntimeStorage = (
  error: RuntimeStorageError,
): ProcessStoreWriteError => {
  if (error instanceof RuntimeStorageDuplicateRecordError) {
    return new ProcessStoreDuplicateRecordError({ id: error.id });
  }
  if (error instanceof RuntimeStorageReadonlyRecordError) {
    return new ProcessStoreReadonlyRecordError({ id: error.id });
  }
  return new ProcessStoreStorageError({ cause: error });
};

export interface ProcessStoreCatchErrorAndLogOptions {
  readonly message?: string;
  readonly level?: "warning" | "error";
  readonly annotations?: Readonly<Record<string, string>>;
}

const errorAnnotations = (error: unknown): Readonly<Record<string, string>> => {
  if (!isRecord(error)) {
    return { "storage.error": String(error) };
  }

  const out: Record<string, string> = {};
  const tag = error["_tag"];
  if (typeof tag === "string") out["storage.error._tag"] = tag;
  const adapter = error["adapter"];
  if (typeof adapter === "string") out["storage.adapter"] = adapter;
  const operation = error["operation"];
  if (typeof operation === "string") out["storage.operation"] = operation;
  const id = error["id"];
  if (typeof id === "string") out["storage.record.id"] = id;
  const field = error["field"];
  if (typeof field === "string") out["storage.field"] = field;
  const detail = error["detail"];
  if (typeof detail === "string") out["storage.detail"] = detail;
  const cause = error["cause"];
  if (cause !== undefined) out["storage.cause"] = String(cause);
  return out;
};

const annotateAll = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  annotations: Readonly<Record<string, string>>,
): Effect.Effect<A, E, R> =>
  Object.entries(annotations).reduce(
    (acc, [key, value]) => acc.pipe(Effect.annotateLogs(key, value)),
    effect,
  );

/**
 * Explicit best-effort boundary for optional storage writes.
 *
 * @internal
 */
export const catchErrorAndLog =
  (options: ProcessStoreCatchErrorAndLogOptions = {}) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<void, never, R> => {
    const message = options.message ?? "ProcessStore effect failed";
    const level = options.level ?? "error";
    const log = level === "error" ? Effect.logError : Effect.logWarning;
    const logError = (error: unknown) =>
      annotateAll(
        log(message),
        {
          ...errorAnnotations(error),
          ...(options.annotations ?? {}),
        },
      );
    return effect.pipe(
      Effect.catch((error: E) => logError(error)),
      Effect.catchCause((cause) =>
        annotateAll(log(message), {
          cause: Cause.pretty(cause),
          ...(options.annotations ?? {}),
        })
      ),
      Effect.asVoid,
    );
  };

/**
 * Combine a list of optional predicates into a single `And`. Undefined
 * entries are skipped. Returns the lone surviving predicate when only one
 * remains, or `undefined` when every entry was undefined.
 *
 * @internal
 */
export const combinePredicates = (
  predicates: ReadonlyArray<RuntimeRecordPredicate | undefined>,
): RuntimeRecordPredicate | undefined => {
  const present = predicates.filter(
    (p): p is RuntimeRecordPredicate => p !== undefined,
  );
  if (present.length === 0) return undefined;
  if (present.length === 1) return present[0];
  return And(present);
};

/**
 * Build the time-window component of a {@link RuntimeRecordQuery} predicate
 * from {@link QueryOpts}. `before` / `after` are inclusive of the row at
 * the boundary the same way {@link applyQueryOpts} treats them — the
 * underlying `Before` / `After` predicates are strict comparisons, so this
 * mirrors the in-memory windowing.
 *
 * @internal
 */
export const timeWindowPredicate = (
  opts: QueryOpts | undefined,
): RuntimeRecordPredicate | undefined => {
  if (opts === undefined) return undefined;
  const parts: RuntimeRecordPredicate[] = [];
  if (opts.before !== undefined) {
    parts.push(Occurred.before(DateTime.makeUnsafe(opts.before)));
  }
  if (opts.after !== undefined) {
    parts.push(Occurred.after(DateTime.makeUnsafe(opts.after)));
  }
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];
  return And(parts);
};

/**
 * Compose a complete {@link RuntimeRecordQuery} from a list of optional
 * predicates plus an optional {@link QueryOpts} window. Always orders by
 * `occurredAt` descending with an `id` descending tiebreaker, and applies
 * the limit. The tiebreaker matches the legacy `byTimestampDesc(...,
 * event.id)` behavior so two rows that share an `occurredAt` (common at
 * millisecond resolution) come back in deterministic order across the
 * memory and SQLite adapters.
 *
 * @internal
 */
export const runtimeRecordQuery = (
  predicates: ReadonlyArray<RuntimeRecordPredicate | undefined>,
  opts: QueryOpts | undefined,
): RuntimeRecordQuery => {
  const predicate = combinePredicates([
    ...predicates,
    timeWindowPredicate(opts),
  ]);
  const base: {
    -readonly [K in keyof RuntimeRecordQuery]: RuntimeRecordQuery[K];
  } = {
    orderBy: [
      { field: "occurredAt", direction: "desc" },
      { field: "id", direction: "desc" },
    ],
  };
  if (predicate !== undefined) {
    base.predicate = predicate;
  }
  if (opts?.limit !== undefined) {
    base.limit = opts.limit;
  }
  return base;
};


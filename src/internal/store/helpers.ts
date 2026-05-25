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
import type { QueryOpts } from "../../ProcessStoreEvent";
import {
  ProcessStoreDuplicateRecordError,
  ProcessStoreReadonlyRecordError,
  type ProcessStoreWriteError,
} from "../../ProcessStoreEvent";
import {
  RuntimeStorageDuplicateRecordError,
  RuntimeStorageReadonlyRecordError,
  type RuntimeStorageError,
} from "../../RuntimeStorage";

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
  return error;
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
 * `occurredAt` descending and applies the limit, matching the legacy
 * `StoreEventQuery` semantics.
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
  const base: { -readonly [K in keyof RuntimeRecordQuery]: RuntimeRecordQuery[K] } = {
    orderBy: [{ field: "occurredAt", direction: "desc" }],
  };
  if (predicate !== undefined) {
    base.predicate = predicate;
  }
  if (opts?.limit !== undefined) {
    base.limit = opts.limit;
  }
  return base;
};

/**
 * Wrap a write effect with the standard "log warnings, never propagate
 * storage errors into the caller's success/error channel" wrapper used by
 * static facet emitters.
 *
 * @internal
 */
export const wrapEmitForFacet =
  (id: string, method: string) =>
  (effect: Effect.Effect<void, ProcessStoreWriteError>): Effect.Effect<void> =>
    effect.pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning(`${id} write failed for ${method}`).pipe(
          Effect.annotateLogs("cause", Cause.pretty(cause)),
        ),
      ),
      Effect.asVoid,
    );

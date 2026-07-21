/**
 * Stable line identity for durable store-tail memo / dedupe.
 *
 * Claim set is keyed by `(scopeKey, lineId)` at the call site: one claim fiber
 * per durable-tail scope. Seed from existing `_logs` rows so rematerialize /
 * restart does not re-append the same line.
 *
 * Not related to store-handle `memoizedAt` in `scopeBridge.ts`.
 *
 * @module internal/logs/lineId
 * @internal
 */

import { Effect, HashSet, Ref } from "effect";
import { LogAnnotationKeys } from "../../LogContext";
import type { LogEntry } from "../../LogEntry";

/** Opaque string identity for one published relay line. @internal */
export type LineId = string & { readonly _tag: "LineId" };

const asLineId = (value: string): LineId => value as LineId;

/**
 * Resolve a memo key for an entry — prefer capture/publish stamp, else a transitional content hash.
 *
 * @internal
 */
export const lineIdFromEntry = (entry: LogEntry): LineId => {
  const stamped = entry.annotations[LogAnnotationKeys.lineId];
  if (stamped !== undefined) {
    return asLineId(stamped);
  }
  return asLineId(
    `${entry.date}\0${entry.level}\0${entry.message}\0${entry.annotations[LogAnnotationKeys.lineage] ?? ""}`,
  );
};

/** Options for {@link makeLineIdClaim}. @internal */
export type LineIdClaimOptions = {
  /**
   * Line ids already durable in this scope (from `_logs.read` at tail start).
   * Empty/omitted ⇒ cold start (in-memory only until first appends).
   */
  readonly seed?: Iterable<LineId>;
};

/**
 * First claim for a {@link LineId} within one store scope wins; later claims return `false`.
 * Pass `seed` from existing `_logs` rows so a rematerialized store does not double-append.
 *
 * @internal
 */
export const makeLineIdClaim = (
  _scopeKey: string,
  options?: LineIdClaimOptions,
): Effect.Effect<(id: LineId) => Effect.Effect<boolean>> =>
  Effect.map(
    Ref.make(HashSet.fromIterable(options?.seed ?? [])),
    (seen) => (id: LineId) =>
      Ref.modify(seen, (set) =>
        HashSet.has(set, id)
          ? ([false, set] as const)
          : ([true, HashSet.add(set, id)] as const),
      ),
  );

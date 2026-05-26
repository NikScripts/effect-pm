/**
 * **Cross-cutting primitives** shared by every {@link ProcessStore} facet.
 *
 * @remarks
 * Each storage facet (queue, run-resource, process lifecycle, …) owns
 * its own concrete fact / change / event types and its own row codec —
 * there is no shared analytics envelope. This module exposes only the
 * primitives every facet still touches:
 *
 * - {@link JsonValue} — structural JSON allowed in `RuntimeRecord.payload`.
 * - {@link QueryOpts} — pagination / time-window controls.
 * - {@link ProcessStoreWriteError} — typed write-failure channel.
 * - {@link AnalyticsEventBase} — minimal shape used by the small set of
 *   facet-owned `*Event` interfaces that already mirror an append-only
 *   row shape (no relation to a previous shared envelope).
 *
 * @module ProcessStoreEvent
 */

import { Data } from "effect";

/**
 * Structural JSON value compatible with persisted record payloads.
 *
 * @public
 */
export type JsonValue =
  | null
  | string
  | number
  | boolean
  | { readonly [key: string]: JsonValue }
  | ReadonlyArray<JsonValue>;

/**
 * Pagination / time window for historical reads.
 *
 * @remarks
 * **Pure-storage queries** (every filter is a pushable
 * `RuntimeRecordPredicate`) pass `QueryOpts` straight to
 * `runtimeRecordQuery(...)`. **Post-filter queries** (any filter
 * applied in TypeScript after decoding) must strip `limit` from the
 * storage query (`windowOpts(opts)`) and re-apply it via
 * `applyQueryOpts(rows, opts, ...)` after decoding — see
 * `src/store/processGroup.ts` and `src/store/processExecution.ts` for
 * worked examples and `docs/STORAGE.md` for the rationale.
 *
 * @public
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
 * Failed write because a row with the same `id` already exists.
 *
 * @public
 */
export class ProcessStoreDuplicateRecordError extends Data.TaggedError(
  "ProcessStoreDuplicateRecordError",
)<{
  readonly id: string;
}> {}

/**
 * Failed write on a row marked `readonly: true`.
 *
 * @public
 */
export class ProcessStoreReadonlyRecordError extends Data.TaggedError(
  "ProcessStoreReadonlyRecordError",
)<{
  readonly id: string;
}> {}

/**
 * Closed union of every error a facet write can return. The
 * `ProcessStore.Service` builder wraps every static optional emitter
 * with `catchCause + logWarning`, so observation paths never see this
 * channel; mocks supplied via `Layer.succeed` / `Effect.provideService`
 * may surface it directly.
 *
 * @public
 */
export type ProcessStoreWriteError =
  | ProcessStoreDuplicateRecordError
  | ProcessStoreReadonlyRecordError;

/**
 * Minimal append-only event shape. Implemented by the small set of
 * facet-owned `*Event` interfaces that decode a single
 * {@link RuntimeRecord} into a typed value (currently
 * {@link ProcessExecutionCompletedEvent},
 * {@link ProcessLifecycleChangedEvent}, {@link LogEntryRecordedEvent}).
 *
 * @public
 */
export interface AnalyticsEventBase {
  id: string;
  type: string;
  /** Epoch milliseconds when the event occurred. */
  occurredAt: number;
  entityType: string;
  entityId: string;
  attributes?: Record<string, unknown>;
}

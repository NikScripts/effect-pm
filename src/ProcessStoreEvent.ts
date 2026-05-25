/**
 * Storage-neutral primitives shared by every {@link ProcessStore} facet.
 *
 * @remarks
 * After the move to per-domain {@link RuntimeRecord} rows there is no
 * shared analytics envelope: each facet owns its own row codec and its
 * own concrete fact / change / event types. This module retains only
 * the cross-cutting primitives every facet still references —
 * structural JSON, query options, the legacy `AnalyticsEventBase`
 * shape used by surviving wire-event types, and the
 * {@link ProcessStoreWriteError} channel.
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
 * @public
 */
export interface QueryOpts {
  limit?: number;
  /** Filter: only events before this epoch millis. */
  before?: number;
  /** Filter: only events after this epoch millis. */
  after?: number;
}

/** @public */
export class ProcessStoreDuplicateRecordError extends Data.TaggedError(
  "ProcessStoreDuplicateRecordError",
)<{
  readonly id: string;
}> {}

/** @public */
export class ProcessStoreReadonlyRecordError extends Data.TaggedError(
  "ProcessStoreReadonlyRecordError",
)<{
  readonly id: string;
}> {}

/** @public */
export type ProcessStoreWriteError =
  | ProcessStoreDuplicateRecordError
  | ProcessStoreReadonlyRecordError;

/**
 * Common fields for surviving facet-owned wire event types.
 *
 * @remarks
 * Some facets still expose a public `*Event` interface that mirrors the
 * old append-only analytics row shape (e.g.
 * {@link ProcessExecutionCompletedEvent},
 * {@link ProcessLifecycleChangedEvent}, {@link LogEntryRecordedEvent}).
 * They each extend this base.
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

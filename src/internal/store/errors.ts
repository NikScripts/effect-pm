/**
 * Store error types shared by public and internal modules.
 *
 * @module internal/store/errors
 * @internal
 */

import { Data } from "effect";

/** @internal */
export class StoreScopeNotRegistered extends Data.TaggedError("StoreScopeNotRegistered")<{
  readonly key: string;
}> {}

/** @internal */
export class StoreDuplicateScopeKey extends Data.TaggedError("StoreDuplicateScopeKey")<{
  readonly key: string;
}> {}

/** @internal */
export class StoreShapeNotMaterialized extends Data.TaggedError("StoreShapeNotMaterialized")<{
  readonly shapeKey: string;
  readonly operation: "append" | "read";
}> {}

/**
 * Emitted on each append when {@link Store.changes} is subscribed.
 *
 * @category models
 * @public
 */
export class StoreChangeEvent extends Data.TaggedClass("StoreChangeEvent")<{
  readonly scopeKey: string;
  readonly method: string;
  readonly payload: unknown;
}> {}

/** @internal */
export class StoreJournalEncodeError extends Data.TaggedError("StoreJournalEncodeError")<{
  readonly cause: unknown;
  readonly detail?: string;
}> {}

/** @internal */
export class StoreJournalDecodeError extends Data.TaggedError("StoreJournalDecodeError")<{
  readonly cause: unknown;
  readonly detail?: string;
}> {}

/**
 * A journal/IO **write** failure surfaced by the storage layer's append path — the categorized,
 * catchable error that write methods honestly carry in their error channel. Wraps the underlying
 * journal/IO write cause. An encode/serialization mismatch stays a defect (`orDie`); this is only the
 * genuine write failure. {@link Store.catchWriteErrors} narrows it out (logs + swallows). @public
 * @category errors
 */
export class StoreWriteError extends Data.TaggedError("StoreWriteError")<{
  readonly cause: unknown;
  readonly detail?: string;
}> {}

/** @internal */
export class StoreJournalQueryError extends Data.TaggedError("StoreJournalQueryError")<{
  readonly operation: "retention";
  readonly scopeKey: string;
  readonly cause: unknown;
}> {}

/** @internal */
export class StoreSqliteConnectionError extends Data.TaggedError("StoreSqliteConnectionError")<{
  readonly cause: unknown;
}> {}

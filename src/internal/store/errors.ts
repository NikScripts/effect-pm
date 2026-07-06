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

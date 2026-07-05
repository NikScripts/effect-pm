/**
 * Store spec entry builders (shared by public {@link Store} and internal facet specs).
 *
 * @module internal/store/builders
 * @internal
 */

import type { Schema } from "effect";
import { APPEND_TAG, QUERY_TAG } from "./spec";

/** @internal */
export const storeAppend = <A>(schema: Schema.Schema<A>): {
  readonly _tag: typeof APPEND_TAG;
  readonly schema: Schema.Schema<A>;
} => ({
  _tag: APPEND_TAG,
  schema,
});

/** @internal */
export const storeQuery = <P, A>(options: {
  readonly from?: string | ReadonlyArray<string>;
  readonly payload: Schema.Schema<P>;
  readonly result: Schema.Schema<A>;
}): {
  readonly _tag: typeof QUERY_TAG;
  readonly from?: string | ReadonlyArray<string>;
  readonly payload: Schema.Schema<P>;
  readonly result: Schema.Schema<A>;
} => ({
  _tag: QUERY_TAG,
  from: options.from,
  payload: options.payload,
  result: options.result,
});

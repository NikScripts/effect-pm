/**
 * Store spec builders and type-level handle inference.
 *
 * @module internal/store/spec
 * @internal
 */

import type { Effect } from "effect";
import type { Schema } from "effect";
import type { MergedSpecForKey as MergedSpecForKeyType } from "./specMerge";

export const APPEND_TAG = "Store/append" as const;
export const QUERY_TAG = "Store/query" as const;

/** @internal */
export interface StoreAppendEntry<A = unknown> {
  readonly _tag: typeof APPEND_TAG;
  readonly schema: Schema.Schema<A>;
}

/** @internal */
export interface StoreQueryEntry<P = unknown, A = unknown> {
  readonly _tag: typeof QUERY_TAG;
  readonly from?: string | ReadonlyArray<string>;
  readonly payload: Schema.Schema<P>;
  readonly result: Schema.Schema<A>;
}

/** @internal */
export type StoreSpecEntry = StoreAppendEntry | StoreQueryEntry;

/** @internal */
export type StoreSpec = Readonly<Record<string, StoreSpecEntry>>;

/** @internal */
export type StoreHandleOf<S extends StoreSpec> = {
  -readonly [K in keyof S]: S[K] extends StoreAppendEntry<infer A>
    ? (payload: A) => Effect.Effect<void>
    : S[K] extends StoreQueryEntry<infer P, infer A>
      ? (payload: P) => Effect.Effect<A>
      : never;
};

/** @internal */
export type StoreHandleForKey<
  Regs extends ReadonlyArray<{ readonly scopeKey: string; readonly spec: StoreSpec }>,
  K extends string,
> = MergedSpecForKeyType<Regs, K> extends infer S extends StoreSpec
  ? StoreHandleOf<S>
  : never;

export type { MergedSpecForKeyType as MergedSpecForKey };

/** @internal */
export const isStoreSpecEntry = (value: unknown): value is StoreSpecEntry =>
  typeof value === "object" &&
  value !== null &&
  "_tag" in value &&
  (value._tag === APPEND_TAG || value._tag === QUERY_TAG);

/** @internal */
export const isStoreSpec = (value: unknown): value is StoreSpec =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every(isStoreSpecEntry);

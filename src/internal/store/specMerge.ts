/**
 * Store spec merge — runtime and type-level extension.
 *
 * @module internal/store/specMerge
 * @internal
 */

import type { StoreSpec } from "./spec";

/** @internal */
export type MergeSpecs<A extends StoreSpec, B extends StoreSpec> = A & B;

/** @internal */
export type MergeSpecTuple<Specs extends ReadonlyArray<StoreSpec>> = Specs extends readonly [
  infer Head extends StoreSpec,
  ...infer Tail extends ReadonlyArray<StoreSpec>,
]
  ? Tail extends readonly []
    ? Head
    : MergeSpecs<Head, MergeSpecTuple<Tail>>
  : Record<string, never>;

/** @internal */
export type UnionToIntersection<U> = (
  U extends unknown ? (value: U) => void : never
) extends (value: infer I) => void
  ? I
  : never;

/** @internal */
export type MergedSpecForKey<
  Regs extends ReadonlyArray<{ readonly scopeKey: string; readonly spec: StoreSpec }>,
  K extends string,
> = UnionToIntersection<
  Extract<Regs[number], { readonly scopeKey: K }> extends { readonly spec: infer S }
    ? S extends StoreSpec
      ? S
      : never
    : never
>;

/** @internal */
export const mergeSpecs = <
  const Specs extends ReadonlyArray<StoreSpec>,
>(
  ...specs: Specs
): MergeSpecTuple<Specs> => Object.assign({}, ...specs) as MergeSpecTuple<Specs>;

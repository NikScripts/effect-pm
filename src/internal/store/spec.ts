/**
 * Store spec builders and type-level handle inference.
 *
 * @module internal/store/spec
 * @internal
 */

import type { Effect } from "effect";
import type { Schema } from "effect";
import type { Simplify } from "effect/Types";
import {
  CUSTOM_APPEND_ALIAS,
  CUSTOM_EFFECT,
  CUSTOM_FN,
  CUSTOM_READ_ALIAS,
  type NormalizedShapes,
  type NormalizeShape,
  type ShapeNamespaceMembers,
  type StoreContractValue,
} from "./contractDef";
import type { MergedSpecForKey as MergedSpecForKeyType } from "./specMerge";

export type { StoreShapes, StoreShapeInput, StoreContractValue } from "./contractDef";

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

/** Plain spec entries — strips {@link Pipeable} and other non-entry keys. @internal */
export type StoreSpecEntriesOf<S> = {
  readonly [K in keyof S as S[K] extends StoreSpecEntry ? K : never]: S[K];
};

/** Normalize contract input, pipeable contract, or legacy flat spec entries. @internal */
export type AsStoreSpec<S> = S extends StoreContractValue
  ? S["spec"]
  : StoreSpecEntriesOf<S> extends StoreSpec
    ? StoreSpecEntriesOf<S>
    : never;

/** Append / read namespace for one normalized shape. @internal */
export type ShapeNamespace<
  N extends { readonly row: Schema.Schema<unknown>; readonly read: Schema.Schema<unknown> },
> = Simplify<ShapeNamespaceMembers<N["row"], N["read"]>>;

/** Shape keys on a materialized contract handle. @internal */
type ShapeHandleKeys<C extends StoreContractValue> = keyof C["normalized"] & string;

/** Custom method keys on a materialized contract handle. @internal */
type CustomHandleKeys<C extends StoreContractValue> = Exclude<
  keyof C["custom"],
  keyof C["normalized"]
> &
  string;

/** Custom method on a handle — resolve read/append aliases via {@link StoreContractValue.customEntries}. @internal */
type CustomMethodOf<
  C extends StoreContractValue,
  K extends CustomHandleKeys<C>,
> = K extends keyof C["customEntries"]
  ? C["customEntries"][K] extends {
      readonly _tag: typeof CUSTOM_READ_ALIAS;
      readonly shapeKey: infer SK extends string;
    }
    ? SK extends keyof C["normalized"] & string
      ? ShapeNamespaceMembers<
          C["normalized"][SK]["row"],
          C["normalized"][SK]["read"]
        >["read"]
      : never
    : C["customEntries"][K] extends {
          readonly _tag: typeof CUSTOM_APPEND_ALIAS;
          readonly shapeKey: infer SK extends string;
        }
      ? SK extends keyof C["normalized"] & string
        ? ShapeNamespaceMembers<C["normalized"][SK]["row"], C["normalized"][SK]["read"]>["append"]
        : never
      : C["customEntries"][K] extends {
            readonly _tag: typeof CUSTOM_EFFECT;
            readonly effect: infer E;
          }
        ? E
        : C["customEntries"][K] extends {
              readonly _tag: typeof CUSTOM_FN;
              readonly fn: infer F;
            }
          ? F
          : C["custom"][K]
  : C["custom"][K];

/** Handle materialized from a {@link StoreContractValue}. @internal */
export type StoreHandleFromContract<C extends StoreContractValue> = Simplify<
  Simplify<{
    readonly [K in ShapeHandleKeys<C>]: ShapeNamespace<C["normalized"][K]>;
  }> & Simplify<{
    readonly [K in CustomHandleKeys<C>]: CustomMethodOf<C, K>;
  }>
>;

/** Flat legacy handle (internal built-ins not yet on contracts). @internal */
export type FlatStoreHandleOf<S extends StoreSpec> = Simplify<{
  -readonly [K in keyof S as S[K] extends StoreSpecEntry ? K : never]: S[K] extends StoreAppendEntry<
    infer A
  >
    ? (payload: A) => Effect.Effect<void>
    : S[K] extends StoreQueryEntry<infer P, infer A>
      ? (payload: P) => Effect.Effect<A>
      : never;
}>;

/** @internal */
export type StoreHandleOf<S> = S extends StoreContractValue
  ? StoreHandleFromContract<S>
  : S extends StoreSpec
    ? FlatStoreHandleOf<S>
    : never;

/** @internal */
export type StoreHandleForKey<
  Regs extends ReadonlyArray<{ readonly scopeKey: string; readonly spec: StoreSpec }>,
  K extends string,
> = MergedSpecForKeyType<Regs, K> extends infer S extends StoreSpec
  ? StoreHandleOf<S>
  : never;

export type { MergedSpecForKeyType as MergedSpecForKey };
export type { NormalizedShapes, NormalizeShape };

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
  Object.entries(value).every(
    ([key, entry]) => key === "pipe" || isStoreSpecEntry(entry),
  );

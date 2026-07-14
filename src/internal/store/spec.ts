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
  type PublicShapeKey,
  type ShapeNamespaceMembers,
  type StoreContractValue,
  type StoreShapeInputLeaf,
  type StoreShapes,
  type StoreShapeTree,
} from "./contractDef";
import type { StoreWriteError } from "./errors";
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
  N extends { readonly row: Schema.Schema<unknown> },
> = Simplify<ShapeNamespaceMembers<N["row"]>>;

/**
 * Reconstruct a leaf shape's `{ append, read }` members. The leaf's row/read schemas are recovered by
 * {@link NormalizeShape}'s `infer … extends` (the store's analogue of `Resource.AsMethod`): prop-presence
 * inference is **F-independent**, so it reduces under a generic row schema (e.g. `queueEvent<F>`) without
 * `TS2589` — unlike `Extract`/`&`/deep-mapping. This is the exact per-leaf computation the flat handle
 * already used, so a flat contract's leaf type is unchanged. @internal
 */
export type AsShape<T extends StoreShapeInputLeaf> = ShapeNamespace<NormalizeShape<T>>;

/**
 * The materialized handle's **shape tree** — recurses the contract's shape tree exactly like
 * `ShapeHandles` in `contractDef`: a leaf → its {@link AsShape} members, a sub-tree → nested handles.
 * A flat contract is the depth-1 case, so its handle type is byte-identical to before.
 *
 * Underscore-prefixed shapes (platform `_logs`, …) are omitted from the public handle type —
 * Effect-style private fields. They remain on the runtime object for internal followers.
 *
 * @internal
 */
export type StoreShapeHandleTree<Shapes extends StoreShapes> = {
  readonly [K in keyof Shapes & string as PublicShapeKey<K>]: Shapes[K] extends StoreShapeInputLeaf
    ? AsShape<Shapes[K]>
    : Shapes[K] extends StoreShapeTree
      ? StoreShapeHandleTree<Shapes[K]>
      : never;
};

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
      ? ShapeNamespaceMembers<C["normalized"][SK]["row"]>["read"]
      : never
    : C["customEntries"][K] extends {
          readonly _tag: typeof CUSTOM_APPEND_ALIAS;
          readonly shapeKey: infer SK extends string;
        }
      ? SK extends keyof C["normalized"] & string
        ? ShapeNamespaceMembers<C["normalized"][SK]["row"]>["append"]
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

/** Handle materialized from a {@link StoreContractValue} — nested shape tree plus top-level custom methods. @internal */
export type StoreHandleFromContract<C extends StoreContractValue> = Simplify<
  Simplify<StoreShapeHandleTree<C["shapes"]>> & Simplify<{
    readonly [K in CustomHandleKeys<C>]: CustomMethodOf<C, K>;
  }>
>;

/** Flat legacy handle (internal built-ins not yet on contracts). @internal */
export type FlatStoreHandleOf<S extends StoreSpec> = Simplify<{
  -readonly [K in keyof S as S[K] extends StoreSpecEntry ? K : never]: S[K] extends StoreAppendEntry<
    infer A
  >
    ? (payload: A) => Effect.Effect<void, StoreWriteError>
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

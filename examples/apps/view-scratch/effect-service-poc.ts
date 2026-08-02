/**
 * @module examples/apps/view-scratch/effect-service-poc
 *
 * **POC — Effect-faithful View service classes** (not shipped).
 *
 * Steal from `Context.Service<Self, Shape>()("Key")`:
 * - **Self** = Context identity (R channel) — F-bounded class name
 * - **Shape** = `View<Props>` — what `Layer.succeed` provides
 * - **Props** = type arg (maps to Shape); defaults to chrome {@link ViewProps}
 * - Instance carries `Service` (Effect `ServiceClass.Shape`) → **no `typeof`** for annotations
 *
 * Compare shipped `View.Prototype` / phantom `Type` in `src/ui/View.tsx`.
 *
 * @see docs/handoffs/view-tag-prototype.md
 */
import type * as React from "react";
import { Context, Data, Layer } from "effect";

// ── minimal chrome (mirror Views.ViewProps / ViewKind) ───────────────────────

export type ViewKind = Data.TaggedEnum<{
  Card: {};
  Detail: {};
  Page: {};
}>;

export const ViewKind = Data.taggedEnum<ViewKind>();

export type CardKind = ReturnType<typeof ViewKind.Card>;
export type DetailKind = ReturnType<typeof ViewKind.Detail>;

export interface ViewProps {
  readonly tag: { readonly key: string };
  readonly name?: string;
}

/** Props in → element out (reversed Hyperlink Shape). */
export type View<Props extends object = ViewProps> = (
  props: Props,
) => React.ReactElement | null;

// ── Effect-style Tag ────────────────────────────────────────────────────────

type TagClass<
  Self,
  K extends string,
  Props extends object,
  Size extends ViewKind | undefined,
> = Context.ServiceClass<Self, K, View<Props>> & {
  readonly size: Size;
  readonly spec?: unknown;
};

/**
 * Class-style View key — same two-stage form as `Context.Service<Self, Shape>()("Id")`.
 *
 * `Props` is ergonomic sugar; Shape on the key is always `View<Props>`
 * (Effect’s `Key.Service` / instance `Self["Service"]`).
 */
export const Tag =
  <Self, Props extends object = ViewProps>() =>
  <const K extends string>(
    key: K,
    statics?: { readonly size?: ViewKind; readonly spec?: unknown },
  ): TagClass<Self, K, Props, ViewKind | undefined> => {
    const base = Context.Service<Self, View<Props>>()(key);
    return Object.assign(base, {
      size: statics?.size,
      spec: statics?.spec,
    }) as TagClass<Self, K, Props, ViewKind | undefined>;
  };

/** Sized Card — `size: ViewKind.Card()` stamped. */
export const Card =
  <Self, Props extends object = ViewProps>() =>
  <const K extends string>(
    key: K,
    statics?: { readonly spec?: unknown },
  ): TagClass<Self, K, Props, CardKind> =>
    Object.assign(Tag<Self, Props>()(key, { ...statics, size: ViewKind.Card() }), {
      size: ViewKind.Card(),
    }) as TagClass<Self, K, Props, CardKind>;

/** Sized Detail — `size: ViewKind.Detail()` stamped. */
export const Detail =
  <Self, Props extends object = ViewProps>() =>
  <const K extends string>(
    key: K,
    statics?: { readonly spec?: unknown },
  ): TagClass<Self, K, Props, DetailKind> =>
    Object.assign(Tag<Self, Props>()(key, { ...statics, size: ViewKind.Detail() }), {
      size: ViewKind.Detail(),
    }) as TagClass<Self, K, Props, DetailKind>;

// ── helpers ─────────────────────────────────────────────────────────────────

/** Shape — works on **instance** type (`PoolCard["Service"]`) or typeof. */
export type ServiceOf<T> = T extends { readonly Service: infer S } ? S : never;

/**
 * Props bag peeled from instance `Service` (Effect Shape) — **no typeof**.
 *
 * @example
 * ```ts
 * type P = PropsOf<DenseCard>
 * const skin: DenseCard["Service"] = (props) => …
 * ```
 */
export type PropsOf<T> = T extends { readonly Service: View<infer P> } ? P : never;

// ── dogfood ─────────────────────────────────────────────────────────────────

export class PoolCard extends Card<PoolCard>()("poc/view/pool-card") {}

export class DenseCard extends Card<
  DenseCard,
  ViewProps & { readonly dense?: boolean }
>()("poc/view/dense-card", { spec: { kind: "dense" } as const }) {}

/** Convenience alias — props of {@link DenseCard}. */
export type DenseProps = PropsOf<DenseCard>;

export class Greeter extends Tag<Greeter, { readonly name: string }>()(
  "poc/view/greeter",
) {}

// ── usage sketches ──────────────────────────────────────────────────────────

/** Annotation via **instance** `Service` — no `typeof`. */
export const poolSkin: PoolCard["Service"] = (props) => {
  void props.tag;
  void props.name;
  return null;
};

export const denseSkin: DenseCard["Service"] = (props) => {
  void props.dense;
  return null;
};

export const greeterSkin: Greeter["Service"] = (props) => {
  void props.name;
  return null;
};

export const layer = Layer.mergeAll(
  Layer.succeed(PoolCard, poolSkin),
  Layer.succeed(DenseCard, denseSkin),
  Layer.succeed(Greeter, greeterSkin),
);

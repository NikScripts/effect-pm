/**
 * @module examples/forms/view/effect-service-poc
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
import { Context, Layer } from "effect";

// ── minimal chrome (mirror View.ViewProps / ViewKind) ───────────────────────

export type ViewKind = "card" | "detail" | "page";

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

/** Sized Card — `size: "card"` literal stamped. */
export const Card =
  <Self, Props extends object = ViewProps>() =>
  <const K extends string>(
    key: K,
    statics?: { readonly spec?: unknown },
  ): TagClass<Self, K, Props, "card"> =>
    Object.assign(Tag<Self, Props>()(key, { ...statics, size: "card" }), {
      size: "card" as const,
    }) as TagClass<Self, K, Props, "card">;

/** Sized Detail — `size: "detail"` literal stamped. */
export const Detail =
  <Self, Props extends object = ViewProps>() =>
  <const K extends string>(
    key: K,
    statics?: { readonly spec?: unknown },
  ): TagClass<Self, K, Props, "detail"> =>
    Object.assign(Tag<Self, Props>()(key, { ...statics, size: "detail" }), {
      size: "detail" as const,
    }) as TagClass<Self, K, Props, "detail">;

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

export const poolSkin2: ServiceOf<PoolCard> = poolSkin;

export const denseSkin: DenseCard["Service"] = (props) => {
  void props.dense;
  void props.tag;
  return null;
};

/** Props from instance Service — no typeof. */
export type DenseProps = PropsOf<DenseCard>;

export const poolLayer = Layer.succeed(PoolCard, (props) => {
  void props.tag;
  return null;
});

export const denseLayer = Layer.succeed(DenseCard, (props) => {
  void props.dense;
  return null;
});

export const greeterLayer = Layer.succeed(Greeter, (props) => {
  void props.name;
  return null;
});

/**
 * @module View
 *
 * View **DI** kernel — Tag, Prototype, provide, Chrome.
 * Hyperlink size chrome (Card/Detail/Page), Registry, bind/only, react, compose
 * stay on `hyperlink-ts/ui/View` (same `View.*` namespace for apps).
 */
import * as React from "react";
import { Context, Layer } from "effect";
import type * as Types from "effect/Types";


// =============================================================================
// Keys / chrome
// =============================================================================

/** Flatten `&` nests so Prototype / Tag hovers stay readable. @internal */
type Flat<T extends object> = { readonly [K in keyof T]: T[K] } & {};

/** Stable view id — prefer `hyperlink/view/<name>`. @public */
export type ViewKey = string;

/**
 * Layout / shell hints for View skins. Navigation is {@link Router} plus
 * {@link GroupNav} for Group drill-down, not here.
 *
 * @public
 */
export interface Chrome {
  readonly width?: number;
  readonly selected?: boolean;
  /** TUI focused panes (Ink). */
  readonly cols?: number;
  readonly rows?: number;
  readonly editMode?: boolean;
}

const ChromeContext = React.createContext<Chrome>({});

/**
 * Provide layout chrome for descendant View skins (e.g. TUI Cell → card width/selection).
 *
 * @public
 */
export const ChromeProvider = (props: {
  readonly value: Chrome;
  readonly children: React.ReactNode;
}): React.ReactElement =>
  React.createElement(ChromeContext.Provider, { value: props.value }, props.children);

/** Read parent {@link Chrome} (empty object when none). @public */
export const useChrome = (): Chrome => React.useContext(ChromeContext);

/**
 * Component Svc for a View tag — **props in, element out** (reversed vs Hyperlink service APIs).
 * Pass a props bag for custom Prototypes.
 *
 * Prefer {@link provide} at the Layer boundary (props infer). Reach for `Tag["Service"]` only when
 * you need a named binding before provide.
 *
 * @example
 * ```ts
 * View.provide(PoolCard, (props) => null)
 * const chrome: View.View = (props) => null // ViewProps
 * ```
 *
 * @public
 */
export type View<Props extends object = {}> = (
  props: Props,
) => React.ReactElement | null;

/**
 * Provide a View skin for a Tag. Props infer from the Tag — no `Tag["Service"]` annotation.
 *
 * Dual: `View.provide(PoolCard, impl)` or `View.provide(PoolCard)(impl)`.
 * Minted Tags also expose {@link ViewHandle.provide} as `PoolCard.provide(impl)`.
 *
 * @example
 * ```ts
 * export const componentsLayer = Layer.mergeAll(
 *   View.provide(PoolCard, ({ tag, name }) => <Card tag={tag} name={name} />),
 *   View.provide(PoolDetail, ({ tag }) => <Detail tag={tag} />),
 * )
 * // pipe: contrib.pipe(Layer.provideMerge(componentsLayer), Layer.provideMerge(View.base))
 * ```
 *
 * @public
 */
export function provide<I, P extends object>(
  tag: Context.Key<I, View<P>>,
): (impl: Types.NoInfer<View<P>>) => Layer.Layer<I>;
export function provide<I, P extends object>(
  tag: Context.Key<I, View<P>>,
  impl: Types.NoInfer<View<P>>,
): Layer.Layer<I>;
export function provide<I, P extends object>(
  tag: Context.Key<I, View<P>>,
  impl?: Types.NoInfer<View<P>>,
): Layer.Layer<I> | ((impl: Types.NoInfer<View<P>>) => Layer.Layer<I>) {
  if (impl === undefined) {
    return (resource) => Layer.succeed(tag, resource);
  }
  return Layer.succeed(tag, impl);
}

// =============================================================================
// Prototype + Tag (DI core)
// =============================================================================

type AnyStatics = Record<string, unknown>;

/**
 * Discharge Requirement when statics already satisfy it (`{}` = fulfilled, like `R = never`).
 * @internal
 */
type NextRequirement<
  Requirement extends AnyStatics,
  Statics extends AnyStatics,
> = Statics extends Requirement ? {} : Requirement;

/**
 * Props bag — from a {@link Prototype}, a handle’s {@link Type} phantom, or
 * instance `Service` (`PoolCard["Service"]`) without `typeof`.
 *
 * @public
 */
export type PropsOf<T> = T extends Prototype<infer Props, infer _R, infer _S>
  ? Props
  : T extends { readonly Service: View<infer P> }
    ? P
    : T extends { readonly Type: infer P extends object }
      ? P
      : never;

/**
 * Accumulated statics type for a {@link Prototype}.
 *
 * @public
 */
export type StaticsOf<P> = P extends Prototype<infer _P, infer _R, infer Statics>
  ? Statics
  : never;

/**
 * Open {@link Prototype} Requirement (debt). `{}` means fulfilled.
 *
 * @public
 */
export type RequirementOf<P> = P extends Prototype<infer _P, infer Requirement, infer _S>
  ? Requirement
  : never;

/**
 * Whether a {@link Prototype}'s Requirement is discharged (`{}`).
 *
 * @public
 */
export type IsFulfilled<P> = [keyof RequirementOf<P>] extends [never] ? true : false;

/**
 * Prototype with an open Requirement (statics may still be empty).
 *
 * @public
 */
export type OpenPrototype<
  Props extends object = {},
  Requirement extends AnyStatics = {},
> = Prototype<Props, Requirement, {}>;

/**
 * Prototype whose Requirement is discharged (`{}`).
 *
 * @public
 */
export type FulfilledPrototype<
  Props extends object = {},
  Statics extends AnyStatics = {},
> = Prototype<Props, {}, Statics>;

/**
 * Constructable View handle from {@link Prototype.Tag}.
 *
 * - **Self** — Context identity (the class)
 * - **Props** — component input (reversed service shape) from the Prototype chain
 * - **Svc** — {@link View}`<Props>` (provide with {@link provide} / {@link ViewHandle.provide})
 *
 * Phantom {@link Type} remains for `View.Type<typeof PoolCard>` / {@link PropsOf}.
 *
 * @public
 */
export type ViewHandle<
  Self,
  K extends string,
  Props extends object,
  Statics extends AnyStatics = {},
> = Context.ServiceClass<Self, K, View<Props>> &
  Flat<Statics> & {
    /** Phantom — component props (`View.Type<typeof PoolCard>` / {@link PropsOf}). */
    readonly Type: Props;
    /**
     * Provide this Tag’s skin — same as {@link provide}`(this, impl)`.
     * Props infer from the handle.
     */
    readonly provide: (impl: View<Props>) => Layer.Layer<Self>;
  };

/**
 * Component props via the Tag phantom (`typeof` path). Prefer {@link PropsOf}`<PoolCard>`
 * or peel from `PoolCard["Service"]`.
 *
 * @public
 */
export type Type<T> = T extends { readonly Type: infer P } ? P : never;

/**
 * Props + statics + an R-style **Requirement** type param (debt until discharged).
 *
 * - `Props` — component props (accumulated, additive)
 * - `Requirement` — type param; may be open (`WithSize`) while statics are still empty
 * - `Statics` — runtime statics (additive); when `Statics extends Requirement`, Requirement
 *   becomes `{}` (fulfilled), like Effect `R → never`
 *
 * Fulfill size via `.Prototype()({ size })` while open, or one-shot
 * `View.Card.Tag()(key, { spec })` on an already-fulfilled size chrome.
 *
 * @example
 * ```ts
 * // One-shot (common) — Effect-shaped mint
 * class PoolCard extends View.Card.Tag<PoolCard>()("…", { spec }) {}
 * class Dense extends View.Card.Tag<Dense, ViewProps & { dense?: boolean }>()("…") {}
 *
 * // Open Requirement chain
 * const Open = View.SizeChrome.Prototype<{ dense?: boolean }>()({ spec })
 * class X extends Open.Prototype()({ size: View.ViewKind.Card() }).Tag<X>()("…") {}
 * ```
 *
 * @public
 */
export interface Prototype<
  in out Props extends object,
  in out Requirement extends AnyStatics = {},
  out Statics extends AnyStatics = {},
> {
  readonly statics: Statics;
  /**
   * Extend props (type arg) and/or statics (value). Both additive.
   * Requirement discharges when merged statics satisfy it.
   */
  readonly Prototype: <NewProps extends object = {},>() => <
    const NewStatics extends AnyStatics = {},
  >(
    statics?: NewStatics,
  ) => Prototype<
    Flat<Props & NewProps>,
    NextRequirement<Requirement, Flat<Statics & NewStatics>>,
    Flat<Statics & NewStatics>
  >;
  /**
   * Mint a Context.Service **class** handle (Effect `Service<Self, View<Props>>()("key")`).
   *
   * - `NewProps` — extra component props (additive)
   * - `statics` — optional runtime statics (`spec`, …); merged onto the class
   * - Skins via {@link provide} / returned handle’s `.provide` (props infer)
   *
   * Does **not** change this Prototype’s Requirement type — returns a class.
   * For `bind`, the class still needs `.size` (use {@link Card} / {@link Detail} /
   * {@link Page}, or pass `size` in statics / fulfill via `.Prototype()` first).
   */
  readonly Tag: <Self, NewProps extends object = {}>() => <
    const K extends string,
    const NewStatics extends AnyStatics = {},
  >(
    key: K,
    statics?: NewStatics,
  ) => ViewHandle<Self, K, Flat<Props & NewProps>, Flat<Statics & NewStatics>>;
}

const makePrototype = <
  Props extends object,
  Requirement extends AnyStatics,
  Statics extends AnyStatics,
>(
  statics: Statics,
): Prototype<Props, Requirement, Statics> => ({
  statics,
  Prototype:
    <NewProps extends object = {},>() =>
    <const NewStatics extends AnyStatics = {},>(next?: NewStatics) => {
      type NextProps = Flat<Props & NewProps>;
      type NextStatics = Flat<Statics & NewStatics>;
      type NextReq = NextRequirement<Requirement, NextStatics>;
      return makePrototype<NextProps, NextReq, NextStatics>({
        ...statics,
        ...(next ?? ({} as NewStatics)),
      });
    },
  Tag:
    <Self, NewProps extends object = {}>() =>
    <const K extends string, const NewStatics extends AnyStatics = {}>(
      key: K,
      next?: NewStatics,
    ) => {
      type NextProps = Flat<Props & NewProps>;
      type NextStatics = Flat<Statics & NewStatics>;
      const merged = {
        ...statics,
        ...(next ?? ({} as NewStatics)),
      } as NextStatics;
      // Infer Object.assign like Group.Tag so class-extends keeps static accessors.
      const base = Context.Service<Self, View<NextProps>>()(key);
      return Object.assign(base, merged, {
        Type: undefined as unknown as NextProps,
        provide: (impl: View<NextProps>): Layer.Layer<Self> =>
          Layer.succeed(base, impl),
      });
    },
});

/**
 * Start a prototype chain: `View.Prototype<Props, Requirement>()(statics?)`.
 *
 * **Requirement** may be declared without fulfilling — pass empty statics, then
 * `.Prototype()({ size: ViewKind.Card() })` later. Discharges to `{}` when statics satisfy it.
 *
 * @example
 * ```ts
 * View.Prototype<{ name: string }>()()
 * View.Prototype<ViewProps, WithSize>()()                      // open
 * View.Prototype<ViewProps, WithSize>()().Prototype()({ size: ViewKind.Card() })
 * ```
 *
 * @public
 */
export const Prototype =
  <Props extends object = {}, Requirement extends AnyStatics = {}>() =>
  <const Statics extends AnyStatics = {}>(
    statics?: Statics,
  ): Prototype<
    Props,
    NextRequirement<Requirement, Statics>,
    Statics
  > =>
    makePrototype<Props, NextRequirement<Requirement, Statics>, Statics>(
      (statics ?? {}) as Statics,
    );

/**
 * Naked View Tag — DI component handle with **no** size chrome.
 * Prefer sized add-ons (`View.Card.Tag`, …) for dashboard skins.
 *
 * @example
 * ```ts
 * class Greeter extends View.Tag<Greeter, { readonly name: string }>()(
 *   "app/view/greeter",
 * ) {}
 * View.provide(Greeter, ({ name }) => <h1>{name}</h1>)
 * // or: Greeter.provide(({ name }) => <h1>{name}</h1>)
 * ```
 *
 * @public
 */
export const Tag = Prototype()().Tag;

/**
 * A View service handle.
 *
 * @public
 */
export type AnyView<Self extends object = object> = Context.Service<
  Self,
  View
> & {
  readonly key: ViewKey;
  readonly size?: { readonly _tag: string };
  readonly spec?: unknown;
};


/**
 * @module View
 *
 * View — Effect service for DI components (React × Effect / Last).
 * Tag, Prototype, provide only. No registry. Dashboard contribution surface
 * is Hyperlink `Views`.
 */
import * as React from "react";
import { Context, Layer } from "effect";
import type * as Types from "effect/Types";

// =============================================================================
// Keys / layout hints
// =============================================================================

/** Flatten `&` nests so Prototype / Tag hovers stay readable. @internal */
type Flat<T extends object> = { readonly [K in keyof T]: T[K] } & {};

/** Stable view id — prefer `app/view/<name>`. @public */
export type ViewKey = string;

/**
 * Layout / shell hints for a provided component (width, selection, …).
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
 * Provide layout chrome for descendant components.
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
 * Component Svc — **props in, element out** (reversed vs typical service APIs).
 *
 * @public
 */
export type View<Props extends object = {}> = (
  props: Props,
) => React.ReactElement | null;

/**
 * Provide a component for a Tag. Props infer from the Tag.
 *
 * Dual: `View.provide(Greeter, impl)` or `View.provide(Greeter)(impl)`.
 * Minted Tags also expose {@link ViewHandle.provide}.
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
// Prototype + Tag
// =============================================================================

type AnyStatics = Record<string, unknown>;

/**
 * Discharge Requirement when statics already satisfy it (`{}` = fulfilled).
 * @internal
 */
type NextRequirement<
  Requirement extends AnyStatics,
  Statics extends AnyStatics,
> = Statics extends Requirement ? {} : Requirement;

/**
 * Merge open debt with debt declared on this chain step.
 * @internal
 */
type MergeRequirement<
  Current extends AnyStatics,
  Added extends AnyStatics,
> = Flat<Current & Added>;

/**
 * Props bag — from a {@link Prototype}, a handle’s {@link Type} phantom, or
 * instance `Service` without `typeof`.
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
 * Accumulated statics bag — from a {@link Prototype} or a minted Tag’s
 * {@link ViewHandle.statics}.
 *
 * @public
 */
export type StaticsOf<P> = P extends Prototype<infer _P, infer _R, infer Statics>
  ? Statics
  : P extends { readonly statics: infer S }
    ? S
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
 * Prototype-managed metadata lives under {@link ViewHandle.statics} (any keys).
 * The class surface stays free for app statics (`static foo = …` on the class).
 *
 * @public
 */
export type ViewHandle<
  Self,
  K extends string,
  Props extends object,
  Statics extends AnyStatics = {},
> = Context.ServiceClass<Self, K, View<Props>> & {
  /** Prototype-managed statics bag (size, spec, …). Not flattened onto the class. */
  readonly statics: Statics;
  /** Phantom — component props. */
  readonly Type: Props;
  /** Provide this Tag’s impl — same as {@link provide}`(this, impl)`. */
  readonly provide: (impl: View<Props>) => Layer.Layer<Self>;
};

/**
 * Component props via the Tag phantom (`typeof` path). Prefer {@link PropsOf}.
 *
 * @public
 */
export type Type<T> = T extends { readonly Type: infer P } ? P : never;

/**
 * Props + statics + an R-style **Requirement** type param (debt until discharged).
 *
 * Requirement may be declared on the root {@link Prototype} factory **or** on any
 * later `.Prototype<Props, Requirement>()` step (additive). Statics discharge debt
 * when they satisfy the merged Requirement (`{}` = fulfilled).
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
   * Extend props / open more Requirement debt (type args) and/or statics (value).
   * New Requirement merges with any still-open debt; discharges when merged
   * statics satisfy the result.
   *
   * @example
   * ```ts
   * const Base = View.Prototype<{ label: string }>()()
   * // add debt mid-chain
   * const Open = Base.Prototype<{}, { readonly size: { readonly _tag: "Card" } }>()()
   * const Done = Open.Prototype()({ size: { _tag: "Card" as const } })
   * ```
   */
  readonly Prototype: <
    NewProps extends object = {},
    NewRequirement extends AnyStatics = {},
  >() => <const NewStatics extends AnyStatics = {}>(
    statics?: NewStatics,
  ) => Prototype<
    Flat<Props & NewProps>,
    NextRequirement<
      MergeRequirement<Requirement, NewRequirement>,
      Flat<Statics & NewStatics>
    >,
    Flat<Statics & NewStatics>
  >;
  /**
   * Mint a Context.Service **class** handle.
   * Does **not** discharge Requirement — fulfill via `.Prototype()` first when needed.
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
    <NewProps extends object = {}, NewRequirement extends AnyStatics = {}>() =>
    <const NewStatics extends AnyStatics = {},>(next?: NewStatics) => {
      type NextProps = Flat<Props & NewProps>;
      type NextStatics = Flat<Statics & NewStatics>;
      type NextReq = NextRequirement<
        MergeRequirement<Requirement, NewRequirement>,
        NextStatics
      >;
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
      const bag = {
        ...statics,
        ...(next ?? ({} as NewStatics)),
      } as NextStatics;
      const base = Context.Service<Self, View<NextProps>>()(key);
      return Object.assign(base, {
        statics: bag,
        Type: undefined as unknown as NextProps,
        provide: (impl: View<NextProps>): Layer.Layer<Self> =>
          Layer.succeed(base, impl),
      });
    },
});

/**
 * Start a prototype chain: `View.Prototype<Props, Requirement>()(statics?)`.
 * Further debt: `.Prototype<NewProps, NewRequirement>()(statics?)` at any step.
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
 * Naked View Tag — DI component handle.
 *
 * @example
 * ```ts
 * class Greeter extends View.Tag<Greeter, { readonly name: string }>()(
 *   "app/view/greeter",
 * ) {}
 * View.provide(Greeter, ({ name }) => <h1>{name}</h1>)
 * ```
 *
 * @public
 */
export const Tag = Prototype()().Tag;

/**
 * A View service handle (DI identity + key). Prototype metadata is on
 * {@link ViewHandle.statics} when minted from a Prototype.
 *
 * @public
 */
export type AnyView<Self extends object = object> = Context.Service<
  Self,
  View
> & {
  readonly key: ViewKey;
};

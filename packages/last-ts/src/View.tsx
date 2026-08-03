/**
 * @module View
 *
 * View — Effect × React components (Last).
 *
 * - **DI:** {@link Tag} / {@link Prototype} / {@link provide} — Context slots
 * - **Plain export:** {@link fromEffect} / {@link gen} / {@link succeed} — Effect
 *   → component (no Tag); runtime from {@link AtomReact.RuntimeProvider}
 * - **Typed JSX:** {@link View} carries services `R`; with `jsxImportSource`
 *   `last-ts`, nested JSX bubbles child `R` into parent {@link Jsx.Element}s
 *
 * Prototype metadata: {@link annotations} (Effect) / {@link getAnnotations}.
 * Factory brand: {@link kind} via {@link Last.kindSym}.
 */
import * as React from "react";
import { Cause, Context, Effect, Layer } from "effect";
import type * as Types from "effect/Types";
import { AsyncResult } from "effect/unstable/reactivity";
import * as AtomReact from "./AtomReact";
import type * as Jsx from "./Jsx";
import * as Last from "./Last";

// =============================================================================
// Keys / layout hints
// =============================================================================

/** Flatten `&` nests so Prototype / Tag hovers stay readable. @internal */
type Flat<T extends object> = { readonly [K in keyof T]: T[K] } & {};

/** Stable view id — prefer `app/view/<name>`. @public */
export type ViewKey = string;

/**
 * Factory brand stamped on every View Tag (`Last.kindOf(tag)`).
 *
 * @public
 */
export const kind = "last-ts/View" as const;

/**
 * Where Prototype-managed metadata (size, spec, …) is stowed on a minted Tag.
 * Read with {@link annotations} — not a public prop on the class.
 *
 * @internal
 */
export const annotationsSym: unique symbol = Symbol.for(
  "last-ts/View/annotations",
);

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
 * Component — props in, React element out, with type-level services `R`.
 *
 * `R` is Effect Context debt: `yield*` inside {@link gen} **plus** nested JSX
 * child requirements when using `jsxImportSource: "last-ts"`. Render returns a
 * normal `ReactElement` (createElement / Radix / shadcn interop); `R` lives on
 * the function type (see {@link stamp}).
 *
 * @public
 */
export type View<Props extends object = {}, R = never> = ((
  props: Props,
) => React.ReactElement | null) & {
  readonly "~last-ts/View/services": R;
};

/**
 * Stamp services `R` onto a plain component fn (type-level; no runtime change).
 *
 * @public
 */
export const stamp = <Props extends object, R = never>(
  component: (props: Props) => React.ReactElement | null,
): View<Props, R> => component as View<Props, R>;

/**
 * Services (`R`) carried by a {@link View} component type.
 *
 * @public
 */
export type ServicesOf<V> = V extends {
  readonly "~last-ts/View/services": infer R;
}
  ? R
  : never;

/**
 * Tree services from a component fn: props.`children` brands ∪ return
 * {@link Jsx.Element}`<R>` (from direct `jsx` / `jsxs` calls).
 *
 * JSX *syntax* (`<Foo />`) is a TypeScript black box (`JSX.Element` / formerly
 * `any`) — it does not contribute `R`. Prefer typed `children` props or
 * `jsx(Child, …)` when nesting must enlarge `View` `R`.
 *
 * @internal
 */
type TreeServicesOf<F> = F extends (props: infer P, ...args: any) => infer Ret
  ? | (P extends object ? Jsx.ServicesOfPropsChildren<P> : never)
    | Jsx.ServicesOf<Exclude<Ret, null | undefined>>
  : never;

/**
 * Effect that builds a plain React component (no {@link Tag} / DI).
 *
 * @public
 */
export type FromEffect<
  Props extends object = {},
  E = never,
  R = never,
> = Effect.Effect<(props: Props) => React.ReactElement | null, E, R>;

/**
 * Turn an Effect-built component into an exportable React component.
 * **Not DI** — for Tags use {@link provide}. Runtime comes from
 * {@link AtomReact.RuntimeProvider} (do not pass a runtime).
 *
 * Return type preserves Effect services `R` and the built component’s tree
 * services as {@link View}`<Props, R | TreeR>`.
 *
 * Client modules that export the result need `"use client"` (or import only
 * from a client parent). Initial/waiting renders `null`; failures throw.
 *
 * @example
 * ```ts
 * import * as View from "last-ts/View"
 *
 * const greeterFx = Effect.succeed((props: { name: string }) => (
 *   <h1>{props.name}</h1>
 * ))
 *
 * export const Greeter = View.fromEffect(greeterFx)
 * ```
 *
 * @public
 */
export const fromEffect = <
  F extends (props: any) => React.ReactElement | null,
  E = never,
  R = never,
>(
  create: Effect.Effect<F, E, R>,
): View<
  Parameters<F>[0] extends object ? Parameters<F>[0] : {},
  R | TreeServicesOf<F>
> => {
  type Props = Parameters<F>[0] extends object ? Parameters<F>[0] : {};
  const FromEffect = (props: Props): React.ReactElement | null => {
    const runtime = AtomReact.useRuntime();
    const atom = React.useMemo(
      () => runtime.atom(create),
      [runtime, create],
    );
    const result = AtomReact.useAtomValue(atom);
    if (AsyncResult.isSuccess(result)) {
      return result.value(props);
    }
    if (AsyncResult.isFailure(result)) {
      throw Cause.squash(result.cause);
    }
    return null;
  };
  return stamp<Props, R | TreeServicesOf<F>>(FromEffect);
};

/**
 * {@link fromEffect}`(Effect.gen(…))` — generator that **returns** a component.
 *
 * `void` / `undefined` from the generator becomes `() => null`.
 * Services `R` = `yield*` debt ∪ tree `R` from the returned component’s JSX.
 *
 * @example
 * ```ts
 * import * as View from "last-ts/View"
 *
 * export const Greeter = View.gen(function* () {
 *   const prefix = yield* Config
 *   return (props: { name: string }) => <h1>{prefix}{props.name}</h1>
 * })
 * ```
 *
 * @public
 */
export function gen<
  Eff extends Effect.Effect<any, any, any>,
  F extends (props: any) => React.ReactElement | null,
>(
  f: () => Generator<Eff, F, never>,
): View<
  Parameters<F>[0] extends object ? Parameters<F>[0] : {},
  Effect.Services<Eff> | TreeServicesOf<F>
>;
export function gen<Eff extends Effect.Effect<any, any, any>>(
  f: () => Generator<Eff, void, never>,
): View<{}, Effect.Services<Eff>>;
export function gen(
  f: () => Generator<Effect.Effect<any, any, any>, any, never>,
): View<object, never> {
  return fromEffect(
    Effect.map(Effect.gen(f), (component) =>
      component === undefined ? () => null : component,
    ),
  ) as View<object, never>;
}

/**
 * {@link fromEffect}`(Effect.succeed(component))` — pure component, no yields.
 *
 * @example
 * ```ts
 * export const Greeter = View.succeed((props: { name: string }) => (
 *   <h1>{props.name}</h1>
 * ))
 * ```
 *
 * @public
 */
export const succeed = <F extends (props: any) => React.ReactElement | null>(
  component: F,
): View<
  Parameters<F>[0] extends object ? Parameters<F>[0] : {},
  TreeServicesOf<F>
> => fromEffect(Effect.succeed(component));

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
): (
  impl: Types.NoInfer<(props: P) => React.ReactElement | null>,
) => Layer.Layer<I>;
export function provide<I, P extends object>(
  tag: Context.Key<I, View<P>>,
  impl: Types.NoInfer<(props: P) => React.ReactElement | null>,
): Layer.Layer<I>;
export function provide<I, P extends object>(
  tag: Context.Key<I, View<P>>,
  impl?: Types.NoInfer<(props: P) => React.ReactElement | null>,
):
  | Layer.Layer<I>
  | ((
      impl: Types.NoInfer<(props: P) => React.ReactElement | null>,
    ) => Layer.Layer<I>) {
  if (impl === undefined) {
    return (resource) => Layer.succeed(tag, stamp<P, never>(resource));
  }
  return Layer.succeed(tag, stamp<P, never>(impl));
}

// =============================================================================
// Prototype + Tag
// =============================================================================

type AnyAnnotations = Record<string, unknown>;

/**
 * Discharge Requirement when annotations already satisfy it (`{}` = fulfilled).
 * @internal
 */
type NextRequirement<
  Requirement extends AnyAnnotations,
  Annotations extends AnyAnnotations,
> = Annotations extends Requirement ? {} : Requirement;

/**
 * Merge open debt with debt declared on this chain step.
 * @internal
 */
type MergeRequirement<
  Current extends AnyAnnotations,
  Added extends AnyAnnotations,
> = Flat<Current & Added>;

/**
 * Props bag — from a {@link Prototype}, a handle’s {@link Type} phantom, or
 * instance `Service` without `typeof`.
 *
 * @public
 */
export type PropsOf<T> = T extends Prototype<infer Props, infer _R, infer _A>
  ? Props
  : T extends { readonly Service: View<infer P, infer _Services> }
    ? P
    : T extends { readonly Type: infer P extends object }
      ? P
      : never;

/**
 * Annotations bag type from a {@link Prototype} or minted Tag.
 *
 * @example
 * ```ts
 * type Size = View.AnnotationsOf<typeof PoolCard>["size"]
 * ```
 *
 * @public
 */
export type AnnotationsOf<P> = P extends Prototype<infer _P, infer _R, infer A>
  ? A
  : P extends { readonly [annotationsSym]: infer A }
    ? A
    : never;

/**
 * Annotations bag for a minted Tag — **Effect** (symbol stamp for now; Context later).
 * Not a class prop. For client components / sync builders use {@link getAnnotations}.
 *
 * @example
 * ```ts
 * const bag = yield* View.annotations(PoolCard)
 * bag.size
 * ```
 *
 * @category getters
 * @public
 */
export const annotations = <A extends AnyAnnotations>(self: {
  readonly [annotationsSym]: A;
}): Effect.Effect<A> => Effect.succeed(self[annotationsSym]);

/**
 * Sync peek of the stamped annotations bag — client components and Layer builders
 * that cannot `yield*`. Prefer {@link annotations} inside Effect.
 *
 * @example
 * ```ts
 * View.getAnnotations(PoolCard).size
 * ```
 *
 * @category getters
 * @public
 */
export const getAnnotations = <A extends AnyAnnotations>(self: {
  readonly [annotationsSym]: A;
}): A => self[annotationsSym];

/**
 * Open {@link Prototype} Requirement (debt). `{}` means fulfilled.
 *
 * @public
 */
export type RequirementOf<P> = P extends Prototype<infer _P, infer Requirement, infer _A>
  ? Requirement
  : never;

/**
 * Whether a {@link Prototype}'s Requirement is discharged (`{}`).
 *
 * @public
 */
export type IsFulfilled<P> = [keyof RequirementOf<P>] extends [never] ? true : false;

/**
 * Prototype with an open Requirement (annotations may still be empty).
 *
 * @public
 */
export type OpenPrototype<
  Props extends object = {},
  Requirement extends AnyAnnotations = {},
> = Prototype<Props, Requirement, {}>;

/**
 * Prototype whose Requirement is discharged (`{}`).
 *
 * @public
 */
export type FulfilledPrototype<
  Props extends object = {},
  Annotations extends AnyAnnotations = {},
> = Prototype<Props, {}, Annotations>;

/**
 * Constructable View handle from {@link Prototype.Tag}.
 *
 * Prototype metadata is under {@link annotationsSym} (read via {@link annotations}).
 * Factory brand is {@link kind} under {@link Last.kindSym}. Class surface stays
 * free for app `static`s.
 *
 * @public
 */
export type ViewHandle<
  Self,
  K extends string,
  Props extends object,
  Annotations extends AnyAnnotations = {},
> = Context.ServiceClass<Self, K, View<Props>> & {
  readonly [annotationsSym]: Annotations;
  readonly [Last.kindSym]: typeof kind;
  /** Phantom — component props. */
  readonly Type: Props;
  /** Provide this Tag’s impl — same as {@link provide}`(this, impl)`. */
  readonly provide: (
    impl: (props: Props) => React.ReactElement | null,
  ) => Layer.Layer<Self>;
};

/**
 * Component props via the Tag phantom (`typeof` path). Prefer {@link PropsOf}.
 *
 * @public
 */
export type Type<T> = T extends { readonly Type: infer P } ? P : never;

/**
 * Props + annotations + an R-style **Requirement** type param (debt until discharged).
 *
 * Requirement may be declared on the root {@link Prototype} factory **or** on any
 * later `.Prototype<Props, Requirement>()` step (additive). Annotations discharge
 * debt when they satisfy the merged Requirement (`{}` = fulfilled).
 *
 * The builder exposes {@link Prototype.annotations} while chaining; minted Tags
 * stamp the bag under {@link annotationsSym} instead.
 *
 * @public
 */
export interface Prototype<
  in out Props extends object,
  in out Requirement extends AnyAnnotations = {},
  out Annotations extends AnyAnnotations = {},
> {
  /** Accumulator while chaining — not present on minted Tags. */
  readonly annotations: Annotations;
  /**
   * Extend props / open more Requirement debt (type args) and/or annotations (value).
   * New Requirement merges with any still-open debt; discharges when merged
   * annotations satisfy the result.
   *
   * @example
   * ```ts
   * const Base = View.Prototype<{ label: string }>()()
   * const Open = Base.Prototype<{}, { readonly size: { readonly _tag: "Card" } }>()()
   * const Done = Open.Prototype()({ size: { _tag: "Card" as const } })
   * Done.annotations.size
   * ```
   */
  readonly Prototype: <
    NewProps extends object = {},
    NewRequirement extends AnyAnnotations = {},
  >() => <const NewAnnotations extends AnyAnnotations = {}>(
    annotations?: NewAnnotations,
  ) => Prototype<
    Flat<Props & NewProps>,
    NextRequirement<
      MergeRequirement<Requirement, NewRequirement>,
      Flat<Annotations & NewAnnotations>
    >,
    Flat<Annotations & NewAnnotations>
  >;
  /**
   * Mint a Context.Service **class** handle.
   * Does **not** discharge Requirement — fulfill via `.Prototype()` first when needed.
   */
  readonly Tag: <Self, NewProps extends object = {}>() => <
    const K extends string,
    const NewAnnotations extends AnyAnnotations = {},
  >(
    key: K,
    annotations?: NewAnnotations,
  ) => ViewHandle<Self, K, Flat<Props & NewProps>, Flat<Annotations & NewAnnotations>>;
}

const makePrototype = <
  Props extends object,
  Requirement extends AnyAnnotations,
  Annotations extends AnyAnnotations,
>(
  bag: Annotations,
): Prototype<Props, Requirement, Annotations> => ({
  annotations: bag,
  Prototype:
    <NewProps extends object = {}, NewRequirement extends AnyAnnotations = {}>() =>
    <const NewAnnotations extends AnyAnnotations = {},>(next?: NewAnnotations) => {
      type NextProps = Flat<Props & NewProps>;
      type NextAnnotations = Flat<Annotations & NewAnnotations>;
      type NextReq = NextRequirement<
        MergeRequirement<Requirement, NewRequirement>,
        NextAnnotations
      >;
      return makePrototype<NextProps, NextReq, NextAnnotations>({
        ...bag,
        ...(next ?? ({} as NewAnnotations)),
      });
    },
  Tag:
    <Self, NewProps extends object = {}>() =>
    <const K extends string, const NewAnnotations extends AnyAnnotations = {}>(
      key: K,
      next?: NewAnnotations,
    ) => {
      type NextProps = Flat<Props & NewProps>;
      type NextAnnotations = Flat<Annotations & NewAnnotations>;
      const merged = {
        ...bag,
        ...(next ?? ({} as NewAnnotations)),
      } as NextAnnotations;
      const base = Context.Service<Self, View<NextProps>>()(key);
      return Object.assign(base, {
        [annotationsSym]: merged,
        [Last.kindSym]: kind,
        Type: undefined as unknown as NextProps,
        provide: (
          impl: (props: NextProps) => React.ReactElement | null,
        ): Layer.Layer<Self> => Layer.succeed(base, stamp<NextProps, never>(impl)),
      });
    },
});

/**
 * Start a prototype chain: `View.Prototype<Props, Requirement>()(annotations?)`.
 * Further debt: `.Prototype<NewProps, NewRequirement>()(annotations?)` at any step.
 *
 * @public
 */
export const Prototype =
  <Props extends object = {}, Requirement extends AnyAnnotations = {}>() =>
  <const Annotations extends AnyAnnotations = {}>(
    annotations?: Annotations,
  ): Prototype<
    Props,
    NextRequirement<Requirement, Annotations>,
    Annotations
  > =>
    makePrototype<Props, NextRequirement<Requirement, Annotations>, Annotations>(
      (annotations ?? {}) as Annotations,
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
 * A View service handle (DI identity + key). Prototype metadata via
 * {@link annotations}; factory brand via {@link Last.kindOf}.
 *
 * @public
 */
export type AnyView<Self extends object = object> = Context.Service<
  Self,
  View
> & {
  readonly key: ViewKey;
};

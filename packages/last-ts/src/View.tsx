/**
 * @module View
 *
 * View — Effect × React components (Last).
 *
 * Use Effect/Layer directly — no View-shaped Layer masks:
 * - **Mint:** {@link Service} — Context slot; service shape is a {@link ViewFn}
 * - **Build:** `Layer.succeed` / `Layer.effect` + `Effect.gen`
 * - **Default Layer:** `static layer = Layer.succeed(This, impl)` (compose deps there)
 * - **Edge:** {@link mount}`(Service)` — uses `Service.layer` (`R` must be `never`)
 * - **Up:** {@link Last.provide} → {@link Last.toLayer}
 *
 * There is no freestanding View value you call as JSX. Always `yield*` a
 * Service (or {@link mount} one at the app edge).
 *
 * Prototype metadata: {@link annotations} / {@link getAnnotations}.
 * Factory brand: {@link kind} via {@link Last.kindSym}.
 *
 * Bake an Effect into a component with {@link effect} (no `<Run effect={…} />`).
 * {@link Service} redesign is parked — use Layer/`mount` as today.
 */
import * as React from "react";
import { Cause, Context, Effect, Layer } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import * as AtomReact from "./AtomReact";
import type * as Jsx from "./Jsx";
import * as Last from "./Last";
import * as pageContext from "./internal/pageContext";

// =============================================================================
// Keys / layout hints
// =============================================================================

/** Flatten `&` nests so Prototype / Service hovers stay readable. @internal */
type Flat<T extends object> = { readonly [K in keyof T]: T[K] } & {};

/** Stable view id — prefer `app/view/<name>`. @public */
export type ViewKey = string;

/**
 * Factory brand stamped on every View Service (`Last.kindOf(service)`).
 *
 * @public
 */
export const kind = "last-ts/View" as const;

/**
 * Where Prototype-managed metadata (size, spec, …) is stowed on a minted Service.
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
 * Phantom brand for open-`R` views (not a JSX call signature).
 *
 * @internal
 */
declare const ViewTypeId: unique symbol;

/**
 * Plain render function — what {@link Layer.succeed} / {@link Layer.effect}
 * install into a {@link Service}.
 *
 * @public
 */
export type ViewFn<Props extends object = {}> = (
  props: Props,
) => React.ReactElement | null;

/**
 * Fulfilled view — legal as a JSX component (`R` is `never`).
 * Produced by {@link mount}; Prefer {@link ViewFn} for Layer implementations.
 *
 * @public
 */
export type Component<
  Props extends object = {},
  Provides = never,
> = ViewFn<Props> & {
  readonly "~last-ts/View/services": never;
  readonly "~last-ts/View/provides": Provides;
};

/**
 * Open requirements — **not** a JSX component. Prefer {@link Service} +
 * `Layer.effect` / `Effect.gen`, then {@link mount} at the edge.
 *
 * Runtime value is still a render function; the type hides the call signature
 * so `<View />` is rejected while `R` is open.
 *
 * @public
 */
export interface Unresolved<
  Props extends object = {},
  R = never,
  Provides = never,
> {
  readonly "~last-ts/View/services": R;
  readonly "~last-ts/View/provides": Provides;
  readonly "~last-ts/View/props": Props;
  readonly [ViewTypeId]: typeof ViewTypeId;
}

/**
 * View with props, services `R`, and upward Provides.
 *
 * - `R = never` → {@link Component} (JSX-legal — only after {@link mount})
 * - otherwise → {@link Unresolved}
 *
 * @public
 */
export type View<
  Props extends object = {},
  R = never,
  Provides = never,
> = [R] extends [never]
  ? Component<Props, Provides>
  : Unresolved<Props, R, Provides>;

/**
 * Services (`R`) carried by a {@link View} type.
 *
 * @public
 */
export type ServicesOf<V> = V extends {
  readonly "~last-ts/View/services": infer R;
}
  ? R
  : never;

/**
 * Upward {@link Last.provide} tokens carried by a {@link View} type.
 *
 * @public
 */
export type ProvidesOf<V> = V extends {
  readonly "~last-ts/View/provides": infer P;
}
  ? P
  : never;

/**
 * Props carried by a {@link View} type.
 *
 * @public
 */
export type ViewPropsOf<V> = V extends {
  readonly "~last-ts/View/props": infer P extends object;
}
  ? P
  : V extends (props: infer P extends object) => any
    ? P
    : {};

/**
 * Tree services from a component fn: props.`children` brands ∪ return
 * {@link Jsx.Element}`<R>` (from direct `jsx` / `jsxs` calls).
 *
 * JSX *syntax* does not contribute `R` — yield Services inside `Effect.gen`.
 *
 * @internal
 */
type TreeServicesOf<F> = F extends (props: infer P, ...args: any) => infer Ret
  ? | (P extends object ? Jsx.ServicesOfPropsChildren<P> : never)
    | Jsx.ServicesOf<Exclude<Ret, null | undefined>>
  : never;

/**
 * Stamp services `R` onto a plain component fn (type-level; no runtime change).
 *
 * Call as `stamp(fn)` to infer `Props` and tree `R` from the implementation.
 * Explicit `stamp<Props, R>(fn)` remains for wiring.
 *
 * @public
 */
export function stamp<F extends (props: any) => React.ReactElement | null>(
  component: F,
): View<
  Parameters<F>[0] extends object ? Parameters<F>[0] : {},
  TreeServicesOf<F>
>;
export function stamp<Props extends object, R = never>(
  component: (props: Props) => React.ReactElement | null,
): View<Props, R>;
export function stamp(
  component: (props: any) => React.ReactElement | null,
): any {
  return component;
}

/**
 * App edge: build a runtime from `service.layer`, resolve the service, render.
 * This is the only public path to a JSX-legal {@link Component}.
 *
 * Compose deps on `static layer` — do **not** pass a second Layer argument.
 * Parameter is structural (`{ layer }`) so Effect Unify on the Service class
 * does not block `View.mount(Hello)`.
 *
 * @example
 * ```ts
 * const App = View.mount(Hello)
 * // render <App who="nik" />
 * ```
 *
 * @public
 */
export const mount: {
  <
    S extends {
      readonly layer: Layer.Layer<any, any, never>;
    },
  >(
    service: S,
  ): Component<S extends { readonly Type: infer P extends object } ? P : {}>;
} = ((service: {
  readonly layer: Layer.Layer<any, any, never>;
}) => {
  const { layer } = service;
  const Shell = Last.app(layer as Layer.Layer<any, any, never>);
  const Mounted = (props: object): React.ReactElement | null =>
    React.createElement(
      Shell.Provider,
      null,
      React.createElement(ServiceRenderer, {
        service: service as unknown as Context.Key<unknown, ViewFn<object>>,
        props,
      }),
    );
  return stamp(Mounted);
}) as typeof mount;

/** Resolve a View Service from the runtime and call it. @internal */
const ServiceRenderer = (props: {
  readonly service: Context.Key<unknown, ViewFn<object>>;
  readonly props: object;
}): React.ReactElement | null => {
  const runtime = AtomReact.useRuntime();
  const atom = React.useMemo(
    () =>
      runtime.atom(
        props.service as unknown as Effect.Effect<ViewFn<object>>,
      ),
    [runtime, props.service],
  );
  const result = AtomReact.useAtomValue(atom);
  if (AsyncResult.isSuccess(result)) {
    return result.value(props.props);
  }
  if (AsyncResult.isFailure(result)) {
    throw Cause.squash(result.cause);
  }
  return null;
};

/**
 * Bake an Effect → ReactNode into a prop-less component (no `<Run effect={…} />`).
 *
 * Under {@link ./Router.Outlet}, provides {@link ./Page.Request} /
 * {@link ./Page.Document} from the React bridges when present.
 *
 * @example
 * ```tsx
 * const Home = View.effect(
 *   Effect.gen(function* () {
 *     const req = yield* Page.Request
 *     yield* (yield* Page.Document).set("Home")
 *     return <h1>{req.pathname}</h1>
 *   }),
 * )
 * handlers.handle("home", Home)
 * ```
 *
 * @public
 */
export const effect = <E = never, R = never>(
  program: Effect.Effect<React.ReactNode, E, R>,
): React.ComponentType<Record<string, never>> => {
  const Baked = (): React.ReactElement | null => {
    const runtime = AtomReact.useRuntime();
    const request = pageContext.useRequestOption();
    const documentApi = pageContext.useDocumentApiOption();
    const atom = React.useMemo(() => {
      let next: Effect.Effect<React.ReactNode, unknown, unknown> = program;
      if (request !== null) {
        next = next.pipe(
          Effect.provideService(pageContext.Request, request),
        );
      }
      if (documentApi !== null) {
        next = next.pipe(
          Effect.provideService(pageContext.Document, documentApi),
        );
      }
      return runtime.atom(next);
    }, [runtime, program, request?.href, documentApi]);
    const result = AtomReact.useAtomValue(atom);
    if (AsyncResult.isSuccess(result)) {
      const node = result.value;
      if (node === null || node === undefined || typeof node === "boolean") {
        return null;
      }
      if (React.isValidElement(node)) return node;
      return React.createElement(React.Fragment, null, node);
    }
    if (AsyncResult.isFailure(result)) {
      throw Cause.squash(result.cause);
    }
    return null;
  };
  Baked.displayName = "View.effect";
  return Baked;
};

// =============================================================================
// Prototype + Service
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
 * Annotations bag type from a {@link Prototype} or minted Service.
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
 * Annotations bag for a minted Service — **Effect** (symbol stamp for now; Context later).
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
 * Constructable View handle from {@link Prototype.Service}.
 *
 * Prototype metadata is under {@link annotationsSym} (read via {@link annotations}).
 * Factory brand is {@link kind} under {@link Last.kindSym}. Class surface stays
 * free for app `static layer` (Effect v4 style).
 *
 * @public
 */
export type ViewHandle<
  Self,
  K extends string,
  Props extends object,
  Annotations extends AnyAnnotations = {},
> = Context.ServiceClass<Self, K, ViewFn<Props>> & {
  readonly [annotationsSym]: Annotations;
  readonly [Last.kindSym]: typeof kind;
  /** Phantom — component props. */
  readonly Type: Props;
};

/**
 * Component props via the service phantom (`typeof` path). Prefer {@link PropsOf}.
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
 * The builder exposes {@link Prototype.annotations} while chaining; minted services
 * stamp the bag under {@link annotationsSym} instead.
 *
 * @public
 */
export interface Prototype<
  in out Props extends object,
  in out Requirement extends AnyAnnotations = {},
  out Annotations extends AnyAnnotations = {},
> {
  /** Accumulator while chaining — not present on minted services. */
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
   * Mint a Context.Service **class** handle (Effect v4 naming).
   * Does **not** discharge Requirement — fulfill via `.Prototype()` first when needed.
   * Add `static layer = Layer.succeed(This, …)` (or `Layer.effect`) for a default Layer.
   */
  readonly Service: <Self, NewProps extends object = {}>() => <
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
  Service:
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
      const base = Context.Service<Self, ViewFn<NextProps>>()(key);
      return Object.assign(base, {
        [annotationsSym]: merged,
        [Last.kindSym]: kind,
        Type: undefined as unknown as NextProps,
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
 * View service handle — Effect v4 `Context.Service` naming.
 * `yield*` to get the {@link ViewFn}. Attach a default Layer with
 * `static layer = Layer.succeed(This, …)` (camelCase `layer`, never `*Live`).
 *
 * @example
 * ```ts
 * class Greeter extends View.Service<Greeter, { readonly name: string }>()(
 *   "app/view/greeter",
 * ) {
 *   static layer = Layer.succeed(Greeter, ({ name }) => <h1>{name}</h1>)
 * }
 *
 * class Hello extends View.Service<Hello, { who: string }>()("app/Hello") {
 *   static layer = Layer.effect(
 *     Hello,
 *     Effect.gen(function* () {
 *       const G = yield* Greeter
 *       return (props: { who: string }) => <G name={props.who} />
 *     }),
 *   ).pipe(Layer.provide(Greeter.layer))
 * }
 *
 * const App = View.mount(Hello)
 * ```
 *
 * @public
 */
export const Service = Prototype()().Service;

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

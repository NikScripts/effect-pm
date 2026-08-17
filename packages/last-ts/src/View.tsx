/**
 * @module View
 *
 * View — Effect × React components (Last).
 *
 * Use Effect/Layer directly — no View-shaped Layer masks:
 * - **Mint:** {@link make} — Context slot; service shape is a {@link ViewFn}
 * - **Leaf defaults:** pass a default component as the 2nd arg (Reference) — HTML lives there
 * - **Build:** const `Layer.succeed` / `Layer.effect` + `Effect.gen` + `yield*` (never `static layer`)
 * - **Edge:** {@link Last.provide}`(Tag, layer)` → {@link ViewFn} (`layer` `R` must be `never`)
 * - **Page runtime:** {@link Last.provider}`(layer)` when Atom / router context is needed
 *
 * There is no freestanding View value you call as JSX. Always `yield*` a
 * minted view (or {@link Last.provide}`(Tag, layer)` at the app edge). Name is {@link make}
 * (HttpApi-shaped), not `Service`.
 *
 * Prototype metadata: {@link annotations} / {@link getAnnotations}.
 * Factory brand: {@link kind} via {@link ./Last.kindSym} (stamped with
 * `internal/kindSym` — do not import `Last` here; that cycles through Link).
 *
 * Turn an Effect into a component with {@link effect} (no `<Run effect={…} />`).
 * Plain React JSX (`react/jsx-runtime`) — no custom `jsxImportSource`.
 */
import * as React from "react";
import { Cause, Context, Effect } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import * as AtomReact from "./AtomReact";
import { kindSym } from "./internal/kindSym";
import * as pageContext from "./internal/pageContext";
import * as pageServices from "./internal/pageServices";

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
 * Plain render function — what `Layer.succeed` / `Layer.effect`
 * install into a Service. Edge: {@link Last.provide}`(Tag, layer)`.
 *
 * @public
 */
export type ViewFn<Props extends object = Record<never, never>> = (
  props: Props,
) => React.ReactElement | null;

/**
 * View render function (alias of {@link ViewFn}).
 *
 * @public
 */
export type View<Props extends object = Record<never, never>> = ViewFn<Props>;

/**
 * Turn an Effect → ReactNode into a prop-less component (no `<Run effect={…} />`).
 *
 * Under {@link ./Router.Outlet}, provides {@link ./Page.Request} from the React
 * bridges when present. Write document fields with {@link ./Page.document}
 * (+ {@link ./Document.Cell} from {@link ./Last.provider}).
 *
 * @example
 * ```tsx
 * const Home = View.effect(
 *   Effect.gen(function* () {
 *     const req = yield* Page.Request
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
  const Comp = (): React.ReactElement | null => {
    const runtime = AtomReact.useRuntime();
    const request = pageContext.useRequestOption();
    const atom = React.useMemo(
      () =>
        request === null
          ? runtime.atom(program)
          : runtime.atom(
              program.pipe(
                Effect.provideService(pageServices.Request, request),
              ),
            ),
      [runtime, program, request?.href],
    );
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
  Comp.displayName = "View.effect";
  return Comp;
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
> = Annotations extends Requirement ? Record<never, never> : Requirement;

/**
 * Merge open Requirement with Requirement declared on this chain step.
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
  : T extends { readonly Service: ViewFn<infer P> }
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
 * Open {@link Prototype} Requirement. `{}` means fulfilled.
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
  Props extends object = Record<never, never>,
  Requirement extends AnyAnnotations = Record<never, never>,
> = Prototype<Props, Requirement, Record<never, never>>;

/**
 * Prototype whose Requirement is discharged (`{}`).
 *
 * @public
 */
export type FulfilledPrototype<
  Props extends object = Record<never, never>,
  Annotations extends AnyAnnotations = Record<never, never>,
> = Prototype<Props, Record<never, never>, Annotations>;

/** Stamps on every minted View handle. @internal */
/**
 * Symbol-keyed stamps on a minted View handle — the annotations bag, the factory kind
 * brand, and the props phantom. Exported so consumer declaration emit can reference the
 * stamped base type by NAME instead of inlining unique-symbol keys (TS4020).
 *
 * @public
 */
export interface ViewStamps<
  Props extends object,
  Annotations extends AnyAnnotations,
> {
  readonly [annotationsSym]: Annotations;
  readonly [kindSym]: typeof kind;
  /** Phantom — component props. */
  readonly Type: Props;
}

/** Required View handle — {@link Context.Service}. @public */
export type ViewHandle<
  Self,
  K extends string,
  Props extends object,
  Annotations extends AnyAnnotations = Record<never, never>,
> = Context.ServiceClass<Self, K, ViewFn<Props>> & ViewStamps<Props, Annotations>;

/** Optional View slot — {@link Context.Reference}. @public */
export type ViewHandleDefault<
  Props extends object,
  Annotations extends AnyAnnotations = Record<never, never>,
> = Context.Reference<ViewFn<Props>> & ViewStamps<Props, Annotations>;

/**
 * Component props via the service phantom (`typeof` path). Prefer {@link PropsOf}.
 *
 * @public
 */
export type Type<T> = T extends { readonly Type: infer P } ? P : never;

/**
 * Props + annotations + an R-style **Requirement** type param (open until discharged).
 *
 * Requirement may be declared on the root {@link Prototype} factory **or** on any
 * later `.Prototype<Props, Requirement>()` step (additive). Annotations discharge
 * open Requirement when they satisfy the merged Requirement (`{}` = fulfilled).
 *
 * The builder exposes {@link Prototype.annotations} while chaining; minted services
 * stamp the bag under {@link annotationsSym} instead.
 *
 * @public
 */
export interface Prototype<
  in out Props extends object,
  in out Requirement extends AnyAnnotations = Record<never, never>,
  out Annotations extends AnyAnnotations = Record<never, never>,
> {
  /** Accumulator while chaining — not present on minted services. */
  readonly annotations: Annotations;
  /**
   * Extend props / open more Requirement (type args) and/or annotations (value).
   * New Requirement merges with any still-open Requirement; discharges when merged
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
    NewProps extends object = Record<never, never>,
    NewRequirement extends AnyAnnotations = Record<never, never>,
  >() => <const NewAnnotations extends AnyAnnotations = Record<never, never>>(
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
   * Mint a View handle (Effect v4 naming).
   *
   * - `Service()(key)` — required {@link Context.Service}
   * - `Service()(key, default)` — optional {@link Context.Reference} (swap via
   *   `Effect.provideService` / Layer)
   * - `Service()(key, annotations)` — required + merge annotation bag (Prototype)
   * - `Service()(key, default, annotations)` — optional + annotations
   *
   * Does **not** discharge Requirement — fulfill via `.Prototype()` first when needed.
   * Leaf HTML / optional slots: pass a default as the 2nd arg. Required Services:
   * install with a const `Layer.succeed` / `Layer.effect` (never `static layer`).
   */
  readonly Service: <Self, NewProps extends object = Record<never, never>>() => {
    <const K extends string, const NewAnnotations extends AnyAnnotations = Record<never, never>>(
      key: K,
      defaultView: ViewFn<Flat<Props & NewProps>>,
      annotations?: NewAnnotations,
    ): ViewHandleDefault<
      Flat<Props & NewProps>,
      Flat<Annotations & NewAnnotations>
    >;
    <const K extends string, const NewAnnotations extends AnyAnnotations = Record<never, never>>(
      key: K,
      annotations?: NewAnnotations,
    ): ViewHandle<
      Self,
      K,
      Flat<Props & NewProps>,
      Flat<Annotations & NewAnnotations>
    >;
  };
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
    <NewProps extends object = Record<never, never>, NewRequirement extends AnyAnnotations = Record<never, never>>() =>
    <const NewAnnotations extends AnyAnnotations = Record<never, never>,>(next?: NewAnnotations) => {
      type NextProps = Flat<Props & NewProps>;
      type NextAnnotations = Flat<Annotations & NewAnnotations>;
      type NextReq = NextRequirement<
        MergeRequirement<Requirement, NewRequirement>,
        NextAnnotations
      >;
      return makePrototype<NextProps, NextReq, NextAnnotations>({
        ...bag,
        // SAFE: omitted annotations mean NewAnnotations inferred its default (empty bag);
        // {} is that value. Pure optional-generic defaulting, nothing to validate.
        ...(next ?? ({} as NewAnnotations)),
      });
    },
  Service: ((<Self, NewProps extends object = Record<never, never>>() =>
    (key: string, second?: unknown, third?: unknown) => {
      type NextProps = Flat<Props & NewProps>;
      let defaultView: ViewFn<NextProps> | undefined;
      let extra: AnyAnnotations = {};
      if (typeof second === "function") {
        // SAFE: erased overload impl — the typed Prototype["Service"] contract above already
        // pinned this arg as ViewFn<NextProps>; the runtime guard re-checks it is a function.
        defaultView = second as ViewFn<NextProps>;
        if (third !== undefined && typeof third === "object" && third !== null) {
          // SAFE: guarded non-null object; the contract typed it as the annotations bag.
          extra = third as AnyAnnotations;
        }
      } else if (
        second !== undefined &&
        typeof second === "object" &&
        second !== null
      ) {
        // SAFE: guarded non-null object; the contract typed it as the annotations bag.
        extra = second as AnyAnnotations;
      }
      const merged = { ...bag, ...extra };
      const stamped = {
        [annotationsSym]: merged,
        [kindSym]: kind,
        // SAFE: phantom props stamp — never read at runtime, only its type is.
        Type: undefined as unknown as NextProps,
      };
      if (defaultView !== undefined) {
        const base = Context.Reference(key, {
          defaultValue: () => defaultView,
        });
        return Object.assign(base, stamped);
      }
      const base = Context.Service<Self, ViewFn<NextProps>>()(key);
      return Object.assign(base, stamped);
    // SAFE: never-erased impl behind the typed Service contract of the Prototype interface;
    // the overloads above are the source of truth. No runtime value to validate.
    }) as Prototype<Props, Requirement, Annotations>["Service"]),
});

/**
 * Start a prototype chain: `View.Prototype<Props, Requirement>()(annotations?)`.
 * Further Requirement: `.Prototype<NewProps, NewRequirement>()(annotations?)` at any step.
 *
 * @public
 */
export const Prototype =
  <Props extends object = Record<never, never>, Requirement extends AnyAnnotations = Record<never, never>>() =>
  <const Annotations extends AnyAnnotations = Record<never, never>>(
    annotations?: Annotations,
  ): Prototype<
    Props,
    NextRequirement<Requirement, Annotations>,
    Annotations
  > =>
    makePrototype<Props, NextRequirement<Requirement, Annotations>, Annotations>(
      // SAFE: omitted annotations mean Annotations inferred its default (empty bag).
      (annotations ?? {}) as Annotations,
    );

/**
 * View service handle — Effect v4 `Context.Service` / `Context.Reference`.
 * `yield*` to get the {@link ViewFn}. Prefer a **const** Layer at the edge —
 * never `static layer` on the class.
 *
 * Pass a default component as the second argument for leaf HTML / optional slots
 * (Reference) — override with `Effect.provideService` / `Layer.provideMerge` for
 * themes, sidebars, nested settings layout, etc.
 *
 * @example
 * ```ts
 * class Greeter extends View.make<Greeter, { readonly name: string }>()(
 *   "app/view/greeter",
 *   ({ name }) => <h1>{name}</h1>,
 * ) {}
 *
 * class Hello extends View.make<Hello, { who: string }>()("app/Hello") {}
 *
 * const helloLayer = Layer.effect(
 *   Hello,
 *   Effect.gen(function* () {
 *     const G = yield* Greeter
 *     return (props: { who: string }) => <G name={props.who} />
 *   }),
 * )
 *
 * // Optional slot — default sidebar; pages can swap
 * class Sidebar extends View.make<Sidebar>()(
 *   "app/Sidebar",
 *   () => <nav data-sidebar="default">Menu</nav>,
 * ) {}
 *
 * const App = Last.provide(Hello, helloLayer)
 * ```
 *
 * Prefer `pipe(layer, Layer.provide(…))` over `layer.pipe(…)`.
 *
 * @public
 */
export const make = Prototype()().Service;

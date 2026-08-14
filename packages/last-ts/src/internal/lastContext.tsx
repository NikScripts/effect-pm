/**
 * Last.context / Last.use / Last.provider(context) / Last.provideContext —
 * React bag over Effect services + router-scoped mount.
 *
 * @internal
 */
import * as React from "react";
import { Context, Layer, Option } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import * as AtomReact from "../AtomReact";
import {
  ContextScope,
  type Api,
  type ApiConstraint,
  type Group,
  type GroupTop,
  isApi,
} from "./routes";
import type { Constraint as RouteConstraint } from "./route";

export const LastContextTypeId = "~last-ts/Last/context" as const;

/** Spec entry: a Context key / Service or a nested Last.context class. */
export type SpecValue = Context.Key<any, any> | LastContextClass<any>;

export type Spec = { readonly [key: string]: SpecValue };

export type LastContextClass<S extends Spec = Spec> = {
  readonly [LastContextTypeId]: typeof LastContextTypeId;
  readonly spec: S;
};

const isLastContext = (u: unknown): u is LastContextClass =>
  typeof u === "function" &&
  u !== null &&
  LastContextTypeId in u &&
  (u as unknown as LastContextClass)[LastContextTypeId] === LastContextTypeId;

const isKey = (u: unknown): u is Context.Key<any, any> =>
  Context.isKey(u) ||
  (typeof u === "function" &&
    u !== null &&
    "key" in u &&
    typeof (u as { readonly key: unknown }).key === "string");

type ServiceValue<T> = [T] extends [LastContextClass<infer Nested>]
  ? TypeOfSpec<Nested>
  : [T] extends [Context.Key<any, infer A>] ? A
  : // View.make classes: Key-shaped at runtime; Shape via Service.Shape
  Context.Service.Shape<T> extends infer S ? ([S] extends [never] ? never : S)
  : never;

/** Resolved value shape for a context spec. */
export type TypeOfSpec<S extends Spec> = {
  readonly [K in keyof S]: ServiceValue<S[K]>;
};

/** Flattened service union for Layer requirements. */
export type ServicesOfSpec<S extends Spec> = {
  [K in keyof S]: S[K] extends LastContextClass<infer Nested>
    ? ServicesOfSpec<Nested>
    : S[K] extends Context.Key<infer I, any>
      ? I
      : never;
}[keyof S];

export type ServicesOf<C> = C extends LastContextClass<infer S>
  ? ServicesOfSpec<S>
  : never;

type BagsStore = {
  readonly get: (ctx: LastContextClass) => object | undefined;
  readonly set: (ctx: LastContextClass, bag: object) => void;
};

const BagsReactContext = React.createContext<BagsStore | null>(null);

/** Effect Context from `Last.provider(layer)` for sync service lookup. */
const EffectReactContext = React.createContext<Context.Context<any> | null>(
  null,
);

export const EffectContextProvider = (props: {
  readonly context: Context.Context<any>;
  readonly children: React.ReactNode;
}): React.ReactElement =>
  React.createElement(
    EffectReactContext.Provider,
    { value: props.context },
    props.children,
  );

/** Sync Context from the layer provider (for Last.link View tags). @internal */
export const useEffectContext = (): Context.Context<any> => {
  const fromLayer = React.useContext(EffectReactContext);
  if (fromLayer !== null) return fromLayer;
  const runtime = AtomReact.useRuntime();
  const result = AtomReact.useAtomValue(runtime);
  if (!AsyncResult.isSuccess(result)) {
    throw new Error("Last: Atom runtime Context not ready");
  }
  return result.value;
};

const resolveBag = (
  effectCtx: Context.Context<any>,
  spec: Spec,
): object => {
  const bag: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(spec)) {
    if (isLastContext(value)) {
      bag[key] = resolveBag(effectCtx, value.spec);
    } else if (isKey(value)) {
      bag[key] = Context.get(effectCtx, value);
    }
  }
  return bag;
};

const registerBags = (
  store: BagsStore,
  effectCtx: Context.Context<any>,
  ctxClass: LastContextClass,
): object => {
  const bag = resolveBag(effectCtx, ctxClass.spec);
  store.set(ctxClass, bag);
  for (const value of Object.values(ctxClass.spec)) {
    if (isLastContext(value)) {
      registerBags(store, effectCtx, value);
    }
  }
  return bag;
};

/**
 * Mint a Last.context base class: `class Site extends Last.context({ … }) {}`.
 *
 * @internal
 */
export const context = <const S extends Spec>(
  spec: S,
): (abstract new () => {}) & LastContextClass<S> => {
  abstract class Ctx {
    static readonly [LastContextTypeId] = LastContextTypeId;
    static readonly spec = spec;
  }
  return Ctx as unknown as (abstract new () => {}) & LastContextClass<S>;
};

/** Active ContextScope classes mounted for the current match (catalog→group→route). */
const ActiveScopesReactContext = React.createContext<
  ReadonlyArray<LastContextClass>
>([]);

/**
 * Tell {@link use} which router scopes are mounted (Outlet sets this).
 *
 * @internal
 */
export const ActiveScopesProvider = (props: {
  readonly scopes: ReadonlyArray<LastContextClass>;
  readonly children: React.ReactNode;
}): React.ReactElement =>
  React.createElement(
    ActiveScopesReactContext.Provider,
    { value: props.scopes },
    props.children,
  );

const readBag = <C extends LastContextClass<any>>(
  store: BagsStore,
  ctx: C,
): TypeOfSpec<C["spec"]> => {
  const bag = store.get(ctx);
  if (bag === undefined) {
    throw new Error(
      "Last.use: context was not registered — mount it via Last.provider(ctx) or a router .context scope on the active path",
    );
  }
  return bag as TypeOfSpec<C["spec"]>;
};

const scopeOf = (
  annotations: Context.Context<never>,
): LastContextClass | undefined => {
  const opt = Context.getOption(
    annotations as Context.Context<ContextScope>,
    ContextScope,
  );
  return Option.isSome(opt) ? opt.value : undefined;
};

/** Marker for {@link use} catalog selectors `(r) => r.docs` / `(r) => r.docs.chapter`. */
const ScopeSelTypeId = "~last-ts/Last/ScopeSel" as const;

type ScopeSel =
  | {
      readonly [ScopeSelTypeId]: typeof ScopeSelTypeId;
      readonly _tag: "group";
      readonly group: GroupTop;
    }
  | {
      readonly [ScopeSelTypeId]: typeof ScopeSelTypeId;
      readonly _tag: "route";
      readonly group: GroupTop;
      readonly route: RouteConstraint;
    };

const isScopeSel = (u: unknown): u is ScopeSel =>
  typeof u === "object" &&
  u !== null &&
  ScopeSelTypeId in u &&
  (u as ScopeSel)[ScopeSelTypeId] === ScopeSelTypeId;

type ScopeTree = {
  readonly [key: string]: ScopeTree | ScopeSel;
};

const scopeTree = (api: ApiConstraint): ScopeTree => {
  const root: Record<string, ScopeTree | ScopeSel> = {};
  for (const g of Object.values(api.groups) as Array<GroupTop>) {
    const groupSel: ScopeSel = {
      [ScopeSelTypeId]: ScopeSelTypeId,
      _tag: "group",
      group: g,
    };
    const nest: Record<string, ScopeTree | ScopeSel> = {};
    for (const route of Object.values(g.routes) as Array<RouteConstraint>) {
      nest[route.identifier] = {
        [ScopeSelTypeId]: ScopeSelTypeId,
        _tag: "route",
        group: g,
        route,
      };
    }
    // Group node is both selectable and a nest of routes.
    root[g.identifier] = Object.assign(groupSel, nest);
  }
  return root;
};

/** Bag type for a catalog’s root `.context(Ctx)`. */
export type RouterContextBag<A> = A extends {
  readonly "~LastContext"?: infer C;
} ? C extends LastContextClass<infer S> ? TypeOfSpec<S>
  : A extends Api<any, any, any, any, infer C2>
    ? C2 extends LastContextClass<infer S2> ? TypeOfSpec<S2>
    : never
  : never
  : never;

/** Bag type for `A["groups"][Id]` `.context(Ctx)`. */
export type RouterGroupContextBag<A, Id extends string> = A extends {
  readonly groups: infer G;
} ? Id extends keyof G
  ? G[Id] extends { readonly "~LastContext"?: infer C }
    ? C extends LastContextClass<infer S> ? TypeOfSpec<S>
    : never
  : G[Id] extends Group<any, any, any, any, any, infer C2>
    ? C2 extends LastContextClass<infer S2> ? TypeOfSpec<S2>
    : never
  : never
  : never
  : never;

const mergeActiveBags = (
  store: BagsStore,
  scopes: ReadonlyArray<LastContextClass>,
): object => {
  const out: Record<string, unknown> = {};
  for (const ctx of scopes) {
    const bag = store.get(ctx);
    if (bag !== undefined) Object.assign(out, bag);
  }
  return out;
};

const useStore = (): BagsStore => {
  const store = React.useContext(BagsReactContext);
  if (store === null) {
    throw new Error(
      "Last.use: wrap the tree in Last.provider(layer) (router scopes mount under Outlet)",
    );
  }
  return store;
};

/**
 * Resolve a context bag under {@link makeContextProvider}, or a router-scoped
 * bag via catalog / group id / `(r) => r.docs` selector.
 *
 * @internal
 */
export function use<C extends LastContextClass<any>>(
  ctx: C,
): TypeOfSpec<C["spec"]>;
export function use<A>(api: A & ApiConstraint): RouterContextBag<A>;
export function use<
  A extends { readonly groups: Record<string, GroupTop> },
  const Id extends keyof A["groups"] & string,
>(api: A & ApiConstraint, groupId: Id): RouterGroupContextBag<A, Id>;
export function use<A>(
  api: A & ApiConstraint,
  select: (tree: ScopeTree) => unknown,
): object;
export function use(
  first: LastContextClass<any> | ApiConstraint,
  second?: string | ((tree: ScopeTree) => unknown),
): object {
  const store = useStore();
  const active = React.useContext(ActiveScopesReactContext);

  if (!isApi(first)) {
    return readBag(store, first);
  }

  const api = first;
  if (second === undefined) {
    if (active.length > 0) {
      return mergeActiveBags(store, active) as RouterContextBag<typeof api>;
    }
    const root = scopeOf(api.annotations);
    if (root === undefined) {
      throw new Error(
        `Last.use: catalog "${api.identifier}" has no .context(…)`,
      );
    }
    return readBag(store, root);
  }

  if (typeof second === "string") {
    const group = api.groups[second] as GroupTop | undefined;
    if (group === undefined) {
      throw new Error(
        `Last.use: group "${second}" not on catalog "${api.identifier}"`,
      );
    }
    const ctx = scopeOf(group.annotations);
    if (ctx === undefined) {
      throw new Error(
        `Last.use: group "${second}" has no .context(…)`,
      );
    }
    return readBag(store, ctx);
  }

  const selected = second(scopeTree(api));
  if (!isScopeSel(selected)) {
    throw new Error(
      "Last.use: selector must return a group or uncalled route (e.g. (r) => r.docs)",
    );
  }
  const annotations =
    selected._tag === "group"
      ? selected.group.annotations
      : selected.route.annotations;
  const ctx = scopeOf(annotations);
  if (ctx === undefined) {
    throw new Error(
      selected._tag === "group"
        ? `Last.use: group "${selected.group.identifier}" has no .context(…)`
        : `Last.use: route "${selected.route.identifier}" has no .context(…)`,
    );
  }
  return readBag(store, ctx);
}

/**
 * Discharge router `.context` Layer requirements (Layout.provide dual).
 * Merges kit outputs into the Layer graph so services stay available at runtime.
 *
 * - `Last.provideContext(kit)` — excludes `Layer` outputs from `R`
 * - `Last.provideContext(Site, kit)` — excludes {@link ServicesOf}`<Site>` (View
 *   Reference defaults need not appear in `kit`)
 *
 * @internal
 */
export const provideContext: {
  <Out, E2, R2>(
    kit: Layer.Layer<Out, E2, R2>,
  ): <A, E, R>(
    self: Layer.Layer<A, E, R>,
  ) => Layer.Layer<A | Out, E | E2, Exclude<R, Out> | R2>;
  <C extends LastContextClass<any>, Out, E2, R2>(
    ctx: C,
    kit: Layer.Layer<Out, E2, R2>,
  ): <A, E, R>(
    self: Layer.Layer<A, E, R>,
  ) => Layer.Layer<
    A | Out,
    E | E2,
    Exclude<R, ServicesOf<C>> | R2
  >;
} = ((
  first: Layer.Layer<any, any, any> | LastContextClass<any>,
  second?: Layer.Layer<any, any, any>,
) => {
  const kit = second ?? (first as Layer.Layer<any, any, any>);
  const ctxClass = second !== undefined
    ? (first as LastContextClass)
    : undefined;
  return <A, E, R>(
    self: Layer.Layer<A, E, R>,
  ): Layer.Layer<any, any, any> => {
    const merged = Layer.provideMerge(self, kit);
    if (ctxClass === undefined) {
      return merged;
    }
    // Type-level discharge of ServicesOf<Ctx>; runtime is provideMerge only.
    return merged;
  };
}) as typeof provideContext;

const providerCache = new WeakMap<
  LastContextClass,
  (props: { readonly children: React.ReactNode }) => React.ReactElement
>();

/** Cached {@link makeContextProvider} per context class. @internal */
export const contextProviderOf = (
  ctxClass: LastContextClass,
): ((props: {
  readonly children: React.ReactNode;
}) => React.ReactElement) => {
  let cached = providerCache.get(ctxClass);
  if (cached === undefined) {
    cached = makeContextProvider(ctxClass);
    providerCache.set(ctxClass, cached);
  }
  return cached;
};

/**
 * Collect ContextScope annotations along the active match (catalog → group → route).
 *
 * @internal
 */
export const activeContextScopes = (
  api: ApiConstraint,
  match: {
    readonly group: GroupTop;
    readonly route: { readonly annotations: Context.Context<never> };
  },
): ReadonlyArray<LastContextClass> => {
  const scopes: Array<LastContextClass> = [];
  const root = scopeOf(api.annotations);
  if (root !== undefined) scopes.push(root);
  const group = scopeOf(match.group.annotations);
  if (group !== undefined) scopes.push(group);
  const route = scopeOf(match.route.annotations);
  if (route !== undefined) scopes.push(route);
  return scopes;
};

/**
 * Nest bag bridges for active scopes (outer = catalog, inner = route).
 *
 * @internal
 */
export const wrapActiveContextScopes = (
  scopes: ReadonlyArray<LastContextClass>,
  body: React.ReactNode,
): React.ReactElement => {
  let node: React.ReactNode = body;
  for (let i = scopes.length - 1; i >= 0; i--) {
    const ctx = scopes[i]!;
    node = React.createElement(contextProviderOf(ctx), null, node);
  }
  return React.createElement(ActiveScopesProvider, {
    scopes,
    children: node,
  });
};

/**
 * React bridge: project Effect Context services into bags for {@link use}.
 *
 * @internal
 */
export const makeContextProvider = (
  ctxClass: LastContextClass,
): ((props: {
  readonly children: React.ReactNode;
}) => React.ReactElement) => {
  const Provider = (props: {
    readonly children: React.ReactNode;
  }): React.ReactElement => {
    const effectCtx = useEffectContext();
    const parent = React.useContext(BagsReactContext);

    const store = React.useMemo((): BagsStore => {
      const map = new Map<object, object>();
      registerBags(
        {
          get: (c) => map.get(c),
          set: (c, bag) => {
            map.set(c, bag);
          },
        },
        effectCtx,
        ctxClass,
      );
      return {
        get: (c) => map.get(c) ?? parent?.get(c),
        set: (c, bag) => {
          map.set(c, bag);
        },
      };
    }, [effectCtx, parent, ctxClass]);

    return React.createElement(
      BagsReactContext.Provider,
      { value: store },
      props.children,
    );
  };
  Provider.displayName = "Last.provider(context)";
  return Provider;
};

/** True when `u` is a Last.context class. @internal */
export const isContextClass = isLastContext;

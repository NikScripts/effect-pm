/**
 * Internal impl for {@link ../ui/Route} — HttpApi-shaped catalog + groups,
 * with generics preserved for typed {@link UrlBuilder} (HttpApiClient pattern).
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { type Pipeable, pipeArguments } from "effect/Pipeable";
import * as Predicate from "effect/Predicate";
import type { Simplify } from "effect/Types";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
} from "effect/unstable/httpapi";
import {
  AsRoutesTypeId,
  type AsRoutesEffect,
} from "./asRoutesBrand";
import * as uiRoute from "./route";
import type { Path } from "./route";
import type * as lastContextModule from "./lastContext";

export type { AsRoutesEffect } from "./asRoutesBrand";

export const TypeId = "~last-ts/Route/Api" as const;
export const GroupTypeId = "~last-ts/Route/Group" as const;

// =============================================================================
// Typed models (HttpApi / HttpApiGroup shape + nested groups)
// =============================================================================

type RouteMap<Routes extends uiRoute.Constraint> = {
  readonly [R in Routes as R["identifier"]]: R;
};

type GroupMap<Groups extends GroupTop> = {
  readonly [G in Groups as G["identifier"]]: G;
};

/**
 * Annotation: destinations come from a Context service (contract-only until
 * {@link resolveApi} / {@link ../RouterBuilder.layer} merges them).
 *
 * @internal
 */
export class FromRoutes extends Context.Service<
  FromRoutes,
  // Identity is deliberately open (`unknown`, not `any`): any app service key fits, and the
  // requirement is surfaced on the typed catalog `R` (resolveApi), not through this shape.
  Context.Key<unknown, ReadonlyArray<uiRoute.Constraint>>
>()("last-ts/internal/routes/FromRoutes") {}

/**
 * Accumulated path prefix for deferred {@link GroupTop.from} destinations.
 * Survives `.prefix` while the group’s route map is still empty.
 *
 * @internal
 */
export class GroupPrefix extends Context.Service<GroupPrefix, Path>()(
  "last-ts/internal/routes/GroupPrefix",
) {}

/**
 * Annotation: a {@link ../Last.context} class scoped to this catalog / group / route.
 * Outlet mounts active-path bag bridges; RouterBuilder owes {@link ../Last.ServicesOf}.
 *
 * @internal
 */
export class ContextScope extends Context.Service<
  ContextScope,
  lastContextModule.LastContextClass
>()("last-ts/internal/routes/ContextScope") {}

/** {@link ../Last.ServicesOf} — type-only; avoids a runtime cycle with lastContext. */
type lastContextServicesOf<C> = lastContextModule.ServicesOf<C>;

/**
 * Erased group shape (`HttpApiGroup.Constraint` / `Top` analogue).
 */
export interface GroupTop extends Pipeable {
  readonly [GroupTypeId]: typeof GroupTypeId;
  readonly identifier: string;
  /** Context key for {@link ../RouterBuilder.group} (`HttpApiGroup.key`). */
  readonly key: string;
  readonly topLevel: boolean;
  readonly routes: Readonly<Record<string, uiRoute.Constraint>>;
  readonly groups: Readonly<Record<string, GroupTop>>;
  readonly annotations: Context.Context<never>;
  /**
   * Phantom — Last.context class from {@link Group.context} (erased on GroupTop).
   * Concrete {@link Group} fills this for `Last.use(App, "docs")` typing.
   */
  readonly "~LastContext"?: unknown;
  add(
    ...items: ReadonlyArray<
      uiRoute.Constraint | GroupTop | HttpApiEndpoint.Constraint
    >
  ): GroupTop;
  /**
   * Declare destinations from a Context service (type only on the contract).
   * Provide the service via Layer before {@link ../RouterBuilder.layer}.
   */
  from(
    service: Context.Service<any, ReadonlyArray<uiRoute.Constraint>>,
  ): GroupTop;
  // `effect` is only on {@link Group} (typed Items + R). Runtime proto still
  // implements it for erased {@link GroupTop} values.
  prefix(prefix: Path): GroupTop;
  /** Scope a Last.context kit to this group. */
  context(ctx: unknown): GroupTop;
  annotate<I, S>(tag: Context.Key<I, S>, value: S): GroupTop;
  annotateMerge<I>(annotations: Context.Context<I>): GroupTop;
  /** Annotate every current route (`HttpApiGroup.annotateEndpoints`). */
  annotateEndpoints<I, S>(tag: Context.Key<I, S>, value: S): GroupTop;
  annotateEndpointsMerge<I>(annotations: Context.Context<I>): GroupTop;
}

/**
 * Success array element type of an Effect (or AsRoutes brand).
 * Must key on {@link AsRoutesTypeId} — bare `extends AsRoutesEffect<infer _>`
 * can match the Effect half of the intersection and bind `Items = never`.
 */
type FromEffectItems<Eff> = Eff extends {
  readonly [AsRoutesTypeId]: unknown;
} ? Eff extends AsRoutesEffect<infer Items> ? Items
: never
  : Eff extends Effect.Effect<infer A, any, any>
    ? A extends ReadonlyArray<infer Item> ? Item
    : never
  : never;

type FromEffectRoutes<Eff> = Extract<FromEffectItems<Eff>, uiRoute.Constraint>;
type FromEffectGroups<Eff> = Extract<FromEffectItems<Eff>, GroupTop>;

type EffectContext<Eff> = Eff extends Effect.Effect<any, any, infer RX> ? RX
  : never;

/**
 * Nested group of destinations — `HttpApiGroup` analogue, plus nested groups.
 *
 * `R` = Context services needed to materialize deferred `from` / `effect`
 * destinations (union’d onto {@link Api} and {@link ../RouterBuilder.layer}).
 */
export interface Group<
  out Id extends string = string,
  in out Routes extends uiRoute.Constraint = never,
  in out Groups extends GroupTop = never,
  out TopLevel extends boolean = boolean,
  out R = never,
  out Ctx = never,
> extends GroupTop {
  readonly identifier: Id;
  readonly topLevel: TopLevel;
  readonly routes: RouteMap<Routes>;
  readonly groups: GroupMap<Groups>;
  readonly "~LastContext"?: Ctx;
  add<
    const A extends ReadonlyArray<
      uiRoute.Constraint | GroupTop | HttpApiEndpoint.Constraint
    >
  >(
    ...items: A
  ): Group<
    Id,
    Routes | ExtractRouteLikes<A[number]>,
    Groups | Extract<A[number], GroupTop>,
    TopLevel,
    | R
    | (A[number] extends Group<string, any, any, any, infer RX> ? RX : never),
    Ctx
  >;
  /**
   * Destinations from an Effect (or branded {@link AsRoutesEffect}).
   *
   * Infer from `Eff` — do **not** overload `AsRoutesEffect` ahead of plain
   * `Effect` (the Effect half of that intersection matches and binds
   * `Items = never`, wiping UrlBuilder + requirements `R`).
   */
  effect<Eff extends Effect.Effect<any, never, any>>(
    effect: Eff,
  ): Group<
    Id,
    Routes | FromEffectRoutes<Eff>,
    Groups | FromEffectGroups<Eff>,
    TopLevel,
    R | EffectContext<Eff>,
    Ctx
  >;
  /**
   * Destinations from a service — phantom-typed onto the group; resolved in
   * {@link ../RouterBuilder.layer}.
   */
  from<I, E extends uiRoute.Constraint>(
    service: Context.Service<I, ReadonlyArray<E>>,
  ): Group<Id, Routes | E, Groups, TopLevel, R | I, Ctx>;
  prefix(prefix: Path): Group<Id, Routes, Groups, TopLevel, R, Ctx>;
  /**
   * Scope a {@link ../Last.context} kit to this group — builder owes its services;
   * fulfill with {@link ../Last.provideContext}.
   */
  context<C>(
    ctx: C,
  ): Group<Id, Routes, Groups, TopLevel, R | lastContextServicesOf<C>, C>;
  annotate<I, S>(
    tag: Context.Key<I, S>,
    value: S,
  ): Group<Id, Routes, Groups, TopLevel, R, Ctx>;
  annotateMerge<I>(
    annotations: Context.Context<I>,
  ): Group<Id, Routes, Groups, TopLevel, R, Ctx>;
  annotateEndpoints<I, S>(
    tag: Context.Key<I, S>,
    value: S,
  ): Group<Id, Routes, Groups, TopLevel, R, Ctx>;
  annotateEndpointsMerge<I>(
    annotations: Context.Context<I>,
  ): Group<Id, Routes, Groups, TopLevel, R, Ctx>;
}

export declare namespace Group {
  export type Constraint = GroupTop;

  /**
   * Phantom service produced by {@link ../RouterBuilder.group}
   * (`HttpApiGroup.Service`).
   */
  export interface Service<ApiId extends string, Identifier extends string> {
    readonly _: unique symbol;
    readonly apiId: ApiId;
    readonly identifier: Identifier;
  }

  /**
   * Union of group implementation services required by {@link ../RouterBuilder.layer}
   * (`HttpApiGroup.ToService`).
   */
  export type ToService<ApiId extends string, G extends Constraint> =
    G extends Constraint ? Service<ApiId, G["identifier"]> : never;

  export type Identifier<G> = G extends Constraint ? G["identifier"] : never;

  export type WithIdentifier<G, Id extends string> = Extract<
    G,
    { readonly identifier: Id }
  >;
}

/** @deprecated Use {@link Group.Constraint} */
export type GroupConstraint = Group.Constraint;

/**
 * Requirements carried by a {@link Group} (`from` / `effect`).
 *
 * Infer every {@link Group} slot — `Routes` / nested `Groups` are `in out`;
 * `any` in those positions fails the `extends` check and drops `RX`.
 *
 * @internal
 */
export type ItemRequirements<Item> = Item extends Group<
  infer _Id,
  infer _Routes,
  infer _Groups,
  infer _Top,
  infer RX
> ? RX
  : never;

/**
 * Route catalog — `HttpApi` analogue.
 *
 * - `R` — services to materialize deferred Effects (`RouterBuilder.layer`)
 * - `DeferredGroups` — groups from {@link Api.groupsEffect} (UrlBuilder /
 *   match only; **not** in {@link Group.ToService} — no define-time builder)
 */
export interface Api<
  out Id extends string = string,
  in out Groups extends GroupTop = never,
  out R = never,
  out DeferredGroups extends GroupTop = never,
  out Ctx = never,
> extends Pipeable {
  new(_: never): Record<never, never>;
  readonly [TypeId]: typeof TypeId;
  readonly identifier: Id;
  readonly groups: GroupMap<Groups>;
  readonly annotations: Context.Context<never>;
  /** Phantom — root Last.context from {@link Api.context}. */
  readonly "~LastContext"?: Ctx;
  add<
    const A extends ReadonlyArray<
      | uiRoute.Constraint
      | GroupTop
      | HttpApiGroup.Constraint
      | HttpApiEndpoint.Constraint
    >
  >(
    ...items: A
  ): Api<
    Id,
    MergeApiAddsFromTuple<Groups, MapApiAddTuple<A>>,
    R | ItemRequirements<A[number]>,
    DeferredGroups,
    Ctx
  >;
  addHttpApi<Id2 extends string, ApiGroups extends HttpApiGroup.Constraint>(
    api: HttpApi.HttpApi<Id2, ApiGroups>,
  ): Api<Id, MergeApiAdds<Groups, GroupTop>, R, DeferredGroups, Ctx>;
  /**
   * Top-level groups from an Effect. Typed for {@link UrlBuilder}; requirements `R`
   * unions the Effect context. Not added to {@link Group.ToService} (handlers
   * via destination {@link ../Route.handle} or a later builder API).
   */
  groupsEffect<
    Eff extends Effect.Effect<ReadonlyArray<GroupTop>, never, any>,
  >(
    effect: Eff,
  ): Api<
    Id,
    Groups,
    R | EffectContext<Eff>,
    DeferredGroups | FromEffectGroups<Eff>,
    Ctx
  >;
  prefix(prefix: Path): Api<Id, Groups, R, DeferredGroups, Ctx>;
  /**
   * Root-scoped {@link ../Last.context} — every match under this catalog.
   * `RouterBuilder.layer` owes the kit services; fulfill with {@link ../Last.provideContext}.
   */
  context<C>(
    ctx: C,
  ): Api<Id, Groups, R | lastContextServicesOf<C>, DeferredGroups, C>;
  annotate<I, S>(
    tag: Context.Key<I, S>,
    value: S,
  ): Api<Id, Groups, R, DeferredGroups, Ctx>;
  annotateMerge<I>(
    context: Context.Context<I>,
  ): Api<Id, Groups, R, DeferredGroups, Ctx>;
}

/**
 * Erased catalog brand (HttpApi.Constraint style) — concrete `Api<Id, Groups>`
 * values are assignable without forcing `Groups = GroupTop`.
 */
export interface ApiConstraint {
  readonly [TypeId]: typeof TypeId;
  readonly identifier: string;
  readonly groups: Readonly<Record<string, GroupTop>>;
  readonly annotations: Context.Context<never>;
  add(...items: ReadonlyArray<ApiAddLike>): ApiConstraint;
  addHttpApi<Id2 extends string, ApiGroups extends HttpApiGroup.Constraint>(
    api: HttpApi.HttpApi<Id2, ApiGroups>,
  ): ApiConstraint;
  groupsEffect(
    effect: Effect.Effect<ReadonlyArray<GroupTop>, never, never>,
  ): ApiConstraint;
  prefix(prefix: Path): ApiConstraint;
  context(ctx: unknown): ApiConstraint;
  annotate<I, S>(tag: Context.Key<I, S>, value: S): ApiConstraint;
  annotateMerge<I>(context: Context.Context<I>): ApiConstraint;
}

export declare namespace Api {
  export type Constraint = ApiConstraint;
  /**
   * Requirements (`effect` / `groupsEffect` / `from`).
   *
   * Infer every slot — `Groups` is `in out`; using `any` there makes the
   * `extends Api<…>` check fail and collapses `R` to `never`.
   */
  export type Context<A> = A extends
    Api<infer _Id, infer _Groups, infer R, infer _Deferred, infer _Ctx> ? R
    : never;
  /** Groups contributed only via {@link Api.groupsEffect}. */
  export type DeferredGroups<A> = A extends
    Api<infer _Id, infer _Groups, infer _R, infer D, infer _Ctx> ? D
    : never;
  /** Root {@link ../Last.context} class stamped by {@link Api.context}. */
  export type ContextClass<A> = A extends
    Api<infer _Id, infer _Groups, infer _R, infer _Deferred, infer Ctx> ? Ctx
    : never;
}

/** @deprecated Use {@link Api.Constraint} */
export type AppConstraint = Api.Constraint;

export type RouteLike = uiRoute.Constraint | GroupTop;

/**
 * Annotation: destinations from {@link GroupTop.effect} (materialized in
 * {@link resolveApi} / {@link ../RouterBuilder.layer}).
 *
 * @internal
 */
export class FromEffect extends Context.Service<
  FromEffect,
  Effect.Effect<Iterable<RouteLike>, never, never>
>()("last-ts/internal/routes/FromEffect") {}

/**
 * Annotation: top-level groups from {@link Api.groupsEffect}.
 *
 * @internal
 */
export class FromGroups extends Context.Service<
  FromGroups,
  Effect.Effect<Iterable<GroupTop>, never, never>
>()("last-ts/internal/routes/FromGroups") {}

/** What {@link GroupTop.add} / {@link Api.add} accept (Router + Effect HttpApi). */
export type GroupAddLike =
  | uiRoute.Constraint
  | GroupTop
  | HttpApiEndpoint.Constraint;

export type ApiAddLike =
  | GroupAddLike
  | HttpApiGroup.Constraint;

/**
 * Catalog destination from an Effect `HttpApiEndpoint` (identity).
 */
export type RouteFromHttpApiEndpoint<E> = E extends HttpApiEndpoint.Constraint
  ? E & uiRoute.Constraint
  : never;

type ExtractRouteLikes<Item> = Extract<Item, uiRoute.Constraint>;

/**
 * Router {@link Group} projected from an Effect `HttpApiGroup`
 * (same identifier / topLevel; endpoints → routes).
 */
export type GroupFromHttpApiGroup<G> = G extends HttpApiGroup.HttpApiGroup<
  infer Id,
  infer Endpoints,
  infer Top
> ? Group<Id, RouteFromHttpApiEndpoint<Endpoints>, never, Top>
  : never;

type MapApiAddItem<Item> = [Item] extends [HttpApiGroup.Constraint]
  ? GroupFromHttpApiGroup<Item>
  : [Item] extends [HttpApiEndpoint.Constraint] ? RouteFromHttpApiEndpoint<Item>
  : Item;

type MapApiAddTuple<
  Tuple extends ReadonlyArray<unknown>,
> = {
  readonly [I in keyof Tuple]: MapApiAddItem<Tuple[I]>;
};

// Bare endpoint → `__top` group; topLevel groups merge into `__top`.
type MergeTopEndpoint<
  Groups extends GroupTop,
  E extends uiRoute.Constraint,
> = Extract<Groups, { readonly identifier: "__top" }> extends infer Top
  ? [Top] extends [never]
    ? Groups | Group<"__top", E, never, true>
    : Top extends Group<"__top", infer Routes, infer Nested, true>
      ? Exclude<Groups, { readonly identifier: "__top" }> | Group<"__top", Routes | E, Nested, true>
      : Groups | Group<"__top", E, never, true>
  : Groups | Group<"__top", E, never, true>;

type MergeTopGroup<
  Groups extends GroupTop,
  G extends GroupTop,
> = G extends Group<infer _Id, infer Routes, infer Nested, true>
  ? Extract<Groups, { readonly identifier: "__top" }> extends infer Top
    ? [Top] extends [never]
      ? Groups | Group<"__top", Routes, Nested, true>
      : Top extends Group<"__top", infer TopRoutes, infer TopNested, true>
        ?
          | Exclude<Groups, { readonly identifier: "__top" }>
          | Group<"__top", TopRoutes | Routes, TopNested | Nested, true>
        : Groups | Group<"__top", Routes, Nested, true>
    : Groups | Group<"__top", Routes, Nested, true>
  : Groups | G;

type MergeApiAdd<Groups extends GroupTop, Item> = [Item] extends
  [uiRoute.Constraint] ? MergeTopEndpoint<Groups, Item>
  : [Item] extends [GroupTop]
    ? [Item["topLevel"]] extends [true] ? MergeTopGroup<Groups, Item>
    : Groups | Item
  : Groups;

type MergeApiAdds<Groups extends GroupTop, Item> = MergeApiAdd<Groups, Item>;

/** Fold a `.add(...)` argument tuple left-to-right (no union distribution). */
type MergeApiAddsFromTuple<
  Groups extends GroupTop,
  Tuple extends ReadonlyArray<unknown>,
> = Tuple extends readonly [infer Head, ...infer Tail]
  ? MergeApiAddsFromTuple<MergeApiAdd<Groups, Head>, Tail>
  : Groups;

export const isGroup = (u: unknown): u is GroupTop =>
  Predicate.hasProperty(u, GroupTypeId);

export const isApi = (u: unknown): u is ApiConstraint =>
  Predicate.hasProperty(u, TypeId);

/** @deprecated Use {@link isApi} */
export const isApp = isApi;

// =============================================================================
// Runtime protos
// =============================================================================

const optionsFromGroup = (g: GroupTop) => ({
  identifier: g.identifier,
  topLevel: g.topLevel,
  routes: g.routes,
  groups: g.groups,
  annotations: g.annotations,
});

/**
 * Effect `HttpApiEndpoint` → catalog destination (identity when path is routable).
 * Page vs Json is the success schema — no projection to a thinner Route.
 *
 * @internal
 */
export const fromHttpApiEndpoint = (
  endpoint: HttpApiEndpoint.Constraint,
): uiRoute.Constraint | undefined => {
  if (!HttpApiEndpoint.isHttpApiEndpoint(endpoint)) return undefined;
  const path = (endpoint as HttpApiEndpoint.Top).path;
  if (typeof path !== "string" || !path.startsWith("/") || path === "*") {
    return undefined;
  }
  return endpoint as uiRoute.Constraint;
};

/**
 * Effect `HttpApiGroup` → Router {@link Group} (same id / topLevel; endpoints kept).
 *
 * @internal
 */
export const fromHttpApiGroup = (
  httpGroup: HttpApiGroup.Top,
): GroupTop => {
  const routes: Array<uiRoute.Constraint> = [];
  for (const endpoint of Object.values(httpGroup.endpoints)) {
    const route = fromHttpApiEndpoint(endpoint);
    if (route !== undefined) routes.push(route);
  }
  return makeGroupProto({
    identifier: httpGroup.identifier,
    topLevel: httpGroup.topLevel,
    routes: Object.fromEntries(routes.map((r) => [r.identifier, r])),
    groups: {},
    annotations: httpGroup.annotations as Context.Context<never>,
  });
};

const groupProto = {
  pipe() {
    // Effect Pipeable protocol — `arguments` is required by `pipeArguments`.
    // eslint-disable-next-line prefer-rest-params -- pipeArguments(this, arguments)
    return pipeArguments(this, arguments);
  },
  add(this: GroupTop, ...items: ReadonlyArray<GroupAddLike>): GroupTop {
    let routes = { ...this.routes } as Record<string, uiRoute.Constraint>;
    let groups = { ...this.groups } as Record<string, GroupTop>;
    for (const item of items) {
      if (HttpApiEndpoint.isHttpApiEndpoint(item)) {
        const route = fromHttpApiEndpoint(item);
        if (route !== undefined) {
          routes = { ...routes, [route.identifier]: route };
        }
      } else if (uiRoute.isRoute(item)) {
        routes = { ...routes, [item.identifier]: item };
      } else if (isGroup(item)) {
        groups = { ...groups, [item.identifier]: item };
      }
    }
    return makeGroupProto({
      ...optionsFromGroup(this),
      routes,
      groups,
    });
  },
  prefix(this: GroupTop, prefix: Path): GroupTop {
    const routes: Record<string, uiRoute.Constraint> = {};
    for (const [id, route] of Object.entries(this.routes)) {
      routes[id] = route.prefix(prefix);
    }
    const groups: Record<string, GroupTop> = {};
    for (const [id, child] of Object.entries(this.groups)) {
      groups[id] = child.prefix(prefix);
    }
    const prev = Context.getOption(this.annotations, GroupPrefix);
    const nextPrefix = Option.isSome(prev)
      ? uiRoute.joinPath(prev.value, prefix)
      : prefix;
    return makeGroupProto({
      ...optionsFromGroup(this),
      routes,
      groups,
      annotations: Context.add(this.annotations, GroupPrefix, nextPrefix),
    });
  },
  annotate<I, S>(
    this: GroupTop,
    tag: Context.Key<I, S>,
    value: S,
  ): GroupTop {
    return makeGroupProto({
      ...optionsFromGroup(this),
      annotations: Context.add(this.annotations, tag, value),
    });
  },
  annotateMerge<I>(
    this: GroupTop,
    annotations: Context.Context<I>,
  ): GroupTop {
    return makeGroupProto({
      ...optionsFromGroup(this),
      annotations: Context.merge(this.annotations, annotations),
    });
  },
  annotateEndpointsMerge<I>(
    this: GroupTop,
    annotations: Context.Context<I>,
  ): GroupTop {
    const routes: Record<string, uiRoute.Constraint> = {};
    for (const [id, route] of Object.entries(this.routes)) {
      routes[id] = route.annotateMerge(annotations as Context.Context<never>);
    }
    return makeGroupProto({
      ...optionsFromGroup(this),
      routes,
    });
  },
  annotateEndpoints<I, S>(
    this: GroupTop,
    tag: Context.Key<I, S>,
    value: S,
  ): GroupTop {
    const routes: Record<string, uiRoute.Constraint> = {};
    for (const [id, route] of Object.entries(this.routes)) {
      routes[id] = route.annotate(tag, value);
    }
    return makeGroupProto({
      ...optionsFromGroup(this),
      routes,
    });
  },
  effect(
    this: GroupTop,
    effect: Effect.Effect<Iterable<RouteLike>, never, never>,
  ): GroupTop {
    // Always defer — interpret in resolveApi / RouterBuilder.layer (Effect R).
    return this.annotate(FromEffect, effect);
  },
  from(
    this: GroupTop,
    service: Context.Service<any, ReadonlyArray<uiRoute.Constraint>>,
  ): GroupTop {
    return this.annotate(FromRoutes, service);
  },
  context(this: GroupTop, ctx: unknown): GroupTop {
    return this.annotate(
      ContextScope,
      ctx as lastContextModule.LastContextClass,
    );
  },
};

const makeGroupProto = (options: {
  readonly identifier: string;
  readonly topLevel: boolean;
  readonly routes: Readonly<Record<string, uiRoute.Constraint>>;
  readonly groups: Readonly<Record<string, GroupTop>>;
  readonly annotations: Context.Context<never>;
}): GroupTop => {
  function RouterGroup() {}
  Object.setPrototypeOf(RouterGroup, groupProto);
  ;(RouterGroup as { key?: string }).key =
    `last-ts/Router/Group/${options.identifier}`;
  return Object.assign(RouterGroup, {
    [GroupTypeId]: GroupTypeId,
    identifier: options.identifier,
    topLevel: options.topLevel,
    routes: options.routes,
    groups: options.groups,
    annotations: options.annotations,
  }) as unknown as GroupTop;
};

/** `HttpApiGroup.make` analogue. */
export const group = <
  const Id extends string,
  const TopLevel extends boolean = false,
>(
  identifier: Id,
  options?: {
    readonly topLevel?: TopLevel | undefined;
  },
): Group<Id, never, never, [TopLevel] extends [true] ? true : false> =>
  makeGroupProto({
    identifier,
    topLevel: options?.topLevel ?? false,
    routes: {},
    groups: {},
    annotations: Context.empty(),
  }) as Group<Id, never, never, [TopLevel] extends [true] ? true : false>;

const optionsFromApi = (api: ApiConstraint) => ({
  identifier: api.identifier,
  groups: api.groups,
  annotations: api.annotations,
});

const appProto = {
  pipe() {
    // Effect Pipeable protocol — `arguments` is required by `pipeArguments`.
    // eslint-disable-next-line prefer-rest-params -- pipeArguments(this, arguments)
    return pipeArguments(this, arguments);
  },
  add(this: ApiConstraint, ...items: ReadonlyArray<ApiAddLike>): ApiConstraint {
    let groups = { ...this.groups } as Record<string, GroupTop>;
    for (const item of items) {
      if (HttpApiGroup.isHttpApiGroup(item)) {
        const converted = fromHttpApiGroup(item);
        groups = { ...groups, [converted.identifier]: converted };
      } else if (
        HttpApiEndpoint.isHttpApiEndpoint(item) ||
        uiRoute.isRoute(item)
      ) {
        // Bare endpoints → synthetic topLevel bag (HttpApi has no bare endpoints).
        const id = "__top";
        const existing = groups[id] ?? group(id, { topLevel: true });
        groups = { ...groups, [id]: existing.add(item) };
      } else if (isGroup(item)) {
        // Keep group identity (incl. topLevel) — matches HttpApi; urlBuilder
        // flattens via `topLevel`, RouterBuilder.group keys by identifier.
        groups = { ...groups, [item.identifier]: item };
      }
    }
    return makeAppProto({
      ...optionsFromApi(this),
      groups,
    });
  },
  addHttpApi<Id extends string, Groups extends HttpApiGroup.Constraint>(
    this: ApiConstraint,
    api: HttpApi.HttpApi<Id, Groups>,
  ): ApiConstraint {
    // Whole HttpApi → mix each HttpApiGroup into this catalog.
    return this.add(
      ...(Object.values(api.groups) as Array<HttpApiGroup.Top>),
    );
  },
  groupsEffect(
    this: ApiConstraint,
    effect: Effect.Effect<Iterable<GroupTop>, never, never>,
  ): ApiConstraint {
    return this.annotate(FromGroups, effect);
  },
  prefix(this: ApiConstraint, prefix: Path): ApiConstraint {
    const groups: Record<string, GroupTop> = {};
    for (const [id, g] of Object.entries(this.groups)) {
      groups[id] = g.prefix(prefix);
    }
    return makeAppProto({
      ...optionsFromApi(this),
      groups,
    });
  },
  annotate<I, S>(
    this: ApiConstraint,
    tag: Context.Key<I, S>,
    value: S,
  ): ApiConstraint {
    return makeAppProto({
      ...optionsFromApi(this),
      annotations: Context.add(this.annotations, tag, value),
    });
  },
  annotateMerge<I>(
    this: ApiConstraint,
    annotations: Context.Context<I>,
  ): ApiConstraint {
    return makeAppProto({
      ...optionsFromApi(this),
      annotations: Context.merge(this.annotations, annotations),
    });
  },
  context(this: ApiConstraint, ctx: unknown): ApiConstraint {
    return this.annotate(
      ContextScope,
      ctx as lastContextModule.LastContextClass,
    );
  },
};

const makeAppProto = (options: {
  readonly identifier: string;
  readonly groups: Readonly<Record<string, GroupTop>>;
  readonly annotations: Context.Context<never>;
}): ApiConstraint => {
  // Constructor-shaped so `class X extends Router.make(…).add(…)` works (HttpApi).
  function RouterApi() {}
  Object.setPrototypeOf(RouterApi, appProto);
  return Object.assign(RouterApi, {
    [TypeId]: TypeId,
    identifier: options.identifier,
    groups: options.groups,
    annotations: options.annotations,
  }) as unknown as ApiConstraint;
};

/** Empty catalog — `HttpApi.make` analogue. */
export const make = <const Id extends string>(identifier: Id): Api<Id, never> =>
  makeAppProto({
    identifier,
    groups: {},
    annotations: Context.empty(),
  }) as unknown as Api<Id, never>;

/**
 * Import an Effect `HttpApi` as a top-level {@link group} bag of converted
 * groups (`HttpApi.addHttpApi` analogue — URL surface only).
 *
 * Prefer mixing groups directly:
 * `Router.make("site").add(HttpApiGroup.make("users").add(...), Router.group(...))`.
 */
export const addHttpApi = <
  Id extends string,
  Groups extends HttpApiGroup.Constraint,
>(
  api: HttpApi.HttpApi<Id, Groups>,
): GroupTop => {
  let bag: GroupTop = group(api.identifier, { topLevel: true });
  for (const httpGroup of Object.values(api.groups) as Array<HttpApiGroup.Top>) {
    const converted = fromHttpApiGroup(httpGroup);
    if (converted.topLevel) {
      bag = bag.add(...Object.values(converted.routes));
    } else {
      bag = bag.add(converted);
    }
  }
  return bag;
};

// =============================================================================
// Reflect / match / urlBuilder
// =============================================================================

export type FlatEntry = {
  readonly identifiers: ReadonlyArray<string>;
  readonly path: Path;
  readonly route: uiRoute.Constraint;
  readonly group: GroupTop;
  readonly annotations: Context.Context<never>;
};

export const flatten = (self: ApiConstraint): ReadonlyArray<FlatEntry> => {
  const out: Array<FlatEntry> = [];
  const walkGroup = (
    g: GroupTop,
    parentAnnotations: Context.Context<never>,
    identifiers: ReadonlyArray<string>,
  ): void => {
    const merged = Context.merge(parentAnnotations, g.annotations);
    const ids =
      g.topLevel || g.identifier === "__top"
        ? identifiers
        : [...identifiers, g.identifier];
    for (const route of Object.values(g.routes)) {
      out.push({
        identifiers: [...ids, route.identifier],
        path: route.path as Path,
        route,
        group: g,
        annotations: Context.merge(merged, route.annotations),
      });
    }
    for (const child of Object.values(g.groups)) {
      walkGroup(child, merged, ids);
    }
  };
  for (const g of Object.values(self.groups)) {
    walkGroup(g, self.annotations, []);
  }
  return out;
};

export type Match = {
  readonly pathname: string;
  readonly identifiers: ReadonlyArray<string>;
  readonly path: Path;
  readonly params: Record<string, string>;
  readonly route: uiRoute.Constraint;
  readonly group: GroupTop;
  readonly annotations: Context.Context<never>;
};

export const match = (
  self: ApiConstraint,
  pathname: string,
): Option.Option<Match> => {
  const normalized =
    pathname === "" || pathname === "/"
      ? "/"
      : pathname.endsWith("/") && pathname.length > 1
        ? pathname.slice(0, -1)
        : pathname;

  let best: Match | undefined;
  let bestScore = -1;

  for (const entry of flatten(self)) {
    // UI match is Page destinations only — Json endpoints are wire handlers.
    if (
      HttpApiEndpoint.isHttpApiEndpoint(entry.route) &&
      !uiRoute.pageSuccess.isPageEndpoint(entry.route)
    ) {
      continue;
    }
    const compiled = uiRoute.compilePath(entry.path);
    const paramsOpt = compiled.match(normalized);
    if (Option.isNone(paramsOpt)) continue;
    const score = entry.path.length;
    if (score < bestScore) continue;
    bestScore = score;
    best = {
      pathname: normalized,
      identifiers: entry.identifiers,
      path: entry.path,
      params: paramsOpt.value,
      route: entry.route,
      group: entry.group,
      annotations: entry.annotations,
    };
  }
  return Option.fromUndefinedOr(best);
};

// =============================================================================
// Typed UrlBuilder — path segments as positional args + optional query
// =============================================================================

/**
 * Optional trailing options for {@link urlBuilder} methods.
 * Query values that are `undefined` are omitted from the href.
 */
export type UrlQueryOptions = {
  readonly query?: {
    readonly [key: string]: string | undefined;
  } | undefined;
};

/** Turn `/docs/:slug` into `` `/docs/${string}` ``; static paths stay literals. */
export type InstantiatePath<P extends string> = string extends P ? string
  : P extends `${infer Head}:${infer Rest}`
    ? Rest extends `${infer _Param}/${infer Tail}`
      ? `${Head}${string}/${InstantiatePath<Tail>}`
    : `${Head}${string}`
  : P extends `${infer Head}*${infer _Splat}` ? `${Head}${string}`
  : P;

/** Path (+ optional `?query`) produced by a urlBuilder method for `Path`. */
export type PathHref<Path extends string> =
  | InstantiatePath<Path>
  | `${InstantiatePath<Path>}?${string}`;

type RoutesOfGroup<G> = G extends
  Group<string, infer Routes, infer Nested, any, any, any>
  ? Routes | RoutesOfGroup<Nested>
  : never;

/**
 * Typed union of all in-app paths for catalog `A` (params → `${string}`).
 * Closed over by {@link ../Router.link} — never bare `string` on `to`.
 *
 * @public
 */
export type PathsOf<A> = A extends
  Api<any, infer Groups, any, infer Deferred, any> ? InstantiatePath<
    Extract<
      RoutesOfGroup<Groups | Deferred>,
      { readonly path: string }
    >["path"]
  >
  : never;

/**
 * Values accepted by a catalog Link `to`: {@link PathsOf} literals or the same
 * with `?query` (urlBuilder output).
 *
 * @public
 */
export type ToHref<A> =
  | PathsOf<A>
  | `${PathsOf<A> & string}?${string}`;

/** Loose builder for erased / runtime contexts. */
export type UrlMethodLoose = ((
  ...args: ReadonlyArray<string | UrlQueryOptions>
) => string) & {
  readonly "~last-ts/pathKeys"?: ReadonlyArray<string>;
};

export type UrlBuilderLoose = {
  readonly [key: string]: UrlBuilderLoose | UrlMethodLoose;
};

/**
 * Path param names in template order.
 * `:pkg/:module` → `["pkg","module"]`; `/health/*nodeId` → `["nodeId"]`.
 */
type PathKeys<S extends string> = S extends
  `${string}:${infer Key}/${infer Rest}`
  ? Key extends `${infer Name}?` ? readonly [Name, ...PathKeys<Rest>]
  : readonly [Key, ...PathKeys<Rest>]
  : S extends `${string}:${infer Key}`
    ? Key extends `${infer Name}?` ? readonly [Name]
    : readonly [Key]
  : S extends `${string}*${infer Splat}` ? readonly [Splat]
  : readonly [];

type PathArgTuple<Keys extends readonly string[]> = {
  [I in keyof Keys]: string;
};

/**
 * Call args: positional path segments, optional `{ query }` last.
 *
 * Use a trailing optional — not `[] | [options]` — so zero-arg calls typecheck
 * (TS rejects empty calls against that rest-union).
 */
type UrlMethodArgs<Keys extends readonly string[]> = Keys extends readonly []
  ? [options?: UrlQueryOptions]
  : [...PathArgTuple<Keys>, options?: UrlQueryOptions];

/** One bag → positional literals in path-key order (distributive over unions). */
type PathArgTupleFromBag<
  Bag extends { readonly [key: string]: string },
  Keys extends readonly string[],
> = {
  [I in keyof Keys]: Keys[I] extends keyof Bag ? Bag[Keys[I] & keyof Bag]
    : string;
};

type UrlMethodArgsFromBags<
  Bags extends { readonly [key: string]: string },
  Keys extends readonly string[],
> = Keys extends readonly [] ? [options?: UrlQueryOptions]
  : Bags extends unknown
    ? [...PathArgTupleFromBag<Bags, Keys>, options?: UrlQueryOptions]
  : never;

type UrlMethod<E extends uiRoute.Constraint> = E extends
  { readonly "~ParamBags": infer Bags extends { readonly [key: string]: string } }
  ? ((
    ...args: UrlMethodArgsFromBags<Bags, PathKeys<E["path"]>>
  ) => PathHref<E["path"]>) & {
    readonly "~last-ts/pathKeys": PathKeys<E["path"]>;
  }
  // Prefer literal `path` — Effect codecs in the Params slot mean concrete
  // endpoints often no longer `extends uiRoute.Route<…>`. Widened
  // `path: string` (e.g. after `Route.params`) stays {@link UrlMethodLoose}.
  : E extends { readonly path: infer PathType extends string }
    ? string extends PathType ? UrlMethodLoose
    : ((...args: UrlMethodArgs<PathKeys<PathType>>) => PathHref<PathType>) & {
      readonly "~last-ts/pathKeys": PathKeys<PathType>;
    }
  : UrlMethodLoose;

const isUrlQueryOptions = (value: unknown): value is UrlQueryOptions =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.keys(value).every((key) => key === "query");

const appendQuery = (
  path: string,
  query: UrlQueryOptions["query"],
): string => {
  if (query === undefined) return path;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) search.set(key, value);
  }
  const qs = search.toString();
  return qs.length === 0 ? path : `${path}?${qs}`;
};

type EndpointMethods<Routes extends uiRoute.Constraint> = {
  readonly [E in Routes as E["identifier"]]: UrlMethod<E>;
};

type EndpointsOfGroup<G> = G extends
  Group<string, infer Routes, infer _N, infer _T, infer _RX> ? Routes
  : never;

type NestedOfGroup<G> = G extends
  Group<string, infer _R, infer Nested, infer _T, infer _RX> ? Nested
  : never;

/** Nested group builders (finite depth — dashboards nest a few levels). */
type GroupBuilder<G> = [G] extends [GroupTop] ? Simplify<
  EndpointMethods<EndpointsOfGroup<G>> & {
    readonly [
      C in Extract<NestedOfGroup<G>, GroupTop & { readonly topLevel: false }> as C["identifier"]
    ]: Simplify<
      EndpointMethods<EndpointsOfGroup<C>> & {
        readonly [
          C2 in Extract<
            NestedOfGroup<C>,
            GroupTop & { readonly topLevel: false }
          > as C2["identifier"]
        ]: EndpointMethods<EndpointsOfGroup<C2>>
      }
    >;
  }
>
  : Record<PropertyKey, never>;

/**
 * Nested group slots on UrlBuilder.
 * Do **not** intersect nested groups with {@link GroupTop} here — that erases
 * `Group<Id, Routes, …>` type parameters and collapses builders to empty objects.
 */
type NestedBuilders<Groups> = {
  readonly [
    G in Extract<Groups, GroupTop & { readonly topLevel: false }> as G["identifier"]
  ]: GroupBuilder<G>;
};

type TopLevelMethods<Groups extends GroupTop> = EndpointMethods<
  EndpointsOfGroup<Extract<Groups, GroupTop & { readonly topLevel: true }>>
> & NestedBuilders<
  NestedOfGroup<Extract<Groups, GroupTop & { readonly topLevel: true }>>
>;

/**
 * Typed URL builder for a catalog.
 * Nested {@link Group}s nest on the builder; `topLevel` flattens.
 * Path params are **positional** (`urls.node("x")`); pass `{ query }` last.
 */
export type UrlBuilder<A extends ApiConstraint = ApiConstraint> = A extends
  Api<infer _Id, infer Groups, infer _R, infer Deferred, infer _Ctx> ? Simplify<
    TopLevelMethods<Extract<Groups | Deferred, { readonly topLevel: true }>> &
      NestedBuilders<Groups | Deferred>
  >
  : UrlBuilderLoose;

/**
 * Materialize deferred `from` / `effect` / `groupsEffect` with
 * `R = never` (sync). Context-backed catalogs must go through
 * {@link ../RouterBuilder.layer} instead.
 *
 * @internal
 */
export const materializeSync = <A extends ApiConstraint>(
  api: A,
): A =>
  Effect.runSync(
    resolveApi(api) as Effect.Effect<A, never, never>,
  );

/** Nested URL builder — positional path args + optional `{ query }`. */
export const urlBuilder = <A extends ApiConstraint>(
  self: A,
  options?: { readonly baseUrl?: URL | string | undefined },
): UrlBuilder<A> => {
  const api = materializeSync(self);
  const root: UrlBuilderLoose = {};
  const withBase = (url: string): string => {
    if (options?.baseUrl === undefined) return url;
    const base = options.baseUrl.toString();
    const q = url.indexOf("?");
    if (q === -1) return new URL(url, base).toString();
    const path = url.slice(0, q);
    const search = url.slice(q);
    return `${new URL(path, base).toString()}${search}`;
  };

  const ensure = (target: UrlBuilderLoose, id: string): UrlBuilderLoose => {
    const existing = target[id];
    if (existing === undefined) {
      const nest: UrlBuilderLoose = {};
      ;(target as Record<string, UrlBuilderLoose | UrlMethodLoose>)[id] = nest;
      return nest;
    }
    if (typeof existing === "function") {
      return existing as unknown as UrlBuilderLoose;
    }
    return existing;
  };

  const setCallable = (
    target: UrlBuilderLoose,
    id: string,
    method: UrlMethodLoose,
  ): void => {
    const existing = target[id];
    const record = target as Record<string, UrlBuilderLoose | UrlMethodLoose>;
    if (existing === undefined) {
      record[id] = method as unknown as UrlBuilderLoose;
      return;
    }
    if (typeof existing === "function") {
      return;
    }
    const fn = Object.assign(
      ((...args: ReadonlyArray<string | UrlQueryOptions>) =>
        method(...args)) as UrlMethodLoose,
      existing,
    );
    record[id] = fn as unknown as UrlBuilderLoose;
  };

  const place = (identifiers: ReadonlyArray<string>, path: Path): void => {
    if (identifiers.length === 0) return;
    let cursor = root;
    for (let i = 0; i < identifiers.length - 1; i++) {
      cursor = ensure(cursor, identifiers[i]!);
    }
    const leafId = identifiers[identifiers.length - 1]!;
    const compiled = uiRoute.compilePath(path);
    const method = Object.assign(
      ((...args: ReadonlyArray<string | UrlQueryOptions>) => {
        const last = args[args.length - 1];
        const optionsArg =
          args.length > compiled.keys.length && isUrlQueryOptions(last)
            ? last
            : args.length === 1 &&
                compiled.keys.length === 0 &&
                isUrlQueryOptions(args[0])
              ? args[0]
              : undefined;
        const pathArgs =
          optionsArg === undefined
            ? args
            : args.slice(0, args.length - 1);
        const params: Record<string, string> = {};
        for (let i = 0; i < compiled.keys.length; i++) {
          const key = compiled.keys[i]!;
          const value = pathArgs[i];
          if (typeof value !== "string") {
            throw new Error(`Missing path parameter: ${key}`);
          }
          params[key] = value;
        }
        return withBase(appendQuery(compiled.build(params), optionsArg?.query));
      }) as UrlMethodLoose,
      { "~last-ts/pathKeys": compiled.keys },
    );
    setCallable(cursor, leafId, method);
  };

  for (const entry of flatten(api)) {
    place(entry.identifiers, entry.path);
  }

  return root as UrlBuilder<A>;
};

export const reflect = (
  self: ApiConstraint,
  options: {
    readonly onGroup?: (entry: {
      readonly group: GroupTop;
      readonly identifiers: ReadonlyArray<string>;
      readonly annotations: Context.Context<never>;
    }) => void;
    readonly onEndpoint?: (entry: {
      readonly route: uiRoute.Constraint;
      readonly group: GroupTop;
      readonly identifiers: ReadonlyArray<string>;
      readonly annotations: Context.Context<never>;
    }) => void;
  },
): void => {
  const walk = (
    g: GroupTop,
    parent: Context.Context<never>,
    identifiers: ReadonlyArray<string>,
  ): void => {
    const merged = Context.merge(parent, g.annotations);
    const ids =
      g.topLevel || g.identifier === "__top"
        ? identifiers
        : [...identifiers, g.identifier];
    options.onGroup?.({
      group: g,
      identifiers: ids,
      annotations: merged,
    });
    for (const route of Object.values(g.routes)) {
      options.onEndpoint?.({
        route,
        group: g,
        identifiers: [...ids, route.identifier],
        annotations: Context.merge(merged, route.annotations),
      });
    }
    for (const child of Object.values(g.groups)) {
      walk(child, merged, ids);
    }
  };
  for (const g of Object.values(self.groups)) {
    walk(g, self.annotations, []);
  }
};

// =============================================================================
// Resolve deferred `group.from(Service)` destinations
// =============================================================================

const stripResolveAnnotations = (
  annotations: Context.Context<never>,
): Context.Context<never> =>
  Context.omit(
    FromRoutes,
    FromEffect,
    GroupPrefix,
  )(annotations) as Context.Context<never>;

const applyPrefix = (
  item: RouteLike,
  prefix: Option.Option<Path>,
): RouteLike => {
  if (Option.isNone(prefix)) return item;
  return item.prefix(prefix.value);
};

/**
 * Merge `from` / `effect` destinations into a group (and nested groups).
 * Applies accumulated {@link GroupPrefix} to deferred endpoints.
 *
 * @internal
 */
export const resolveGroup = (
  g: GroupTop,
): Effect.Effect<GroupTop, never, never> =>
  Effect.gen(function* () {
    const children: Record<string, GroupTop> = {};
    for (const [id, child] of Object.entries(g.groups)) {
      children[id] = yield* resolveGroup(child);
    }

    let routes = { ...g.routes } as Record<string, uiRoute.Constraint>;
    let groups = children;
    const prefix = Context.getOption(g.annotations, GroupPrefix);

    const fromTag = Context.getOption(g.annotations, FromRoutes);
    if (Option.isSome(fromTag)) {
      // SAFE: the stored key's Identifier is dynamic (`from(service)`); its requirement is
      // surfaced on the typed catalog `R` (resolveApi), so this internal read erases it.
      const destinations: ReadonlyArray<uiRoute.Constraint> = yield* (fromTag
        .value as unknown as Effect.Effect<
        ReadonlyArray<uiRoute.Constraint>,
        never,
        never
      >);
      for (const route of destinations) {
        const next = applyPrefix(route, prefix) as uiRoute.Constraint;
        routes = { ...routes, [next.identifier]: next };
      }
    }

    const fromEffect = Context.getOption(g.annotations, FromEffect);
    if (Option.isSome(fromEffect)) {
      const items = Array.from(yield* fromEffect.value);
      for (const item of items) {
        const next = applyPrefix(item, prefix);
        if (isGroup(next)) {
          groups = {
            ...groups,
            [next.identifier]: yield* resolveGroup(next),
          };
        } else if (uiRoute.isRoute(next)) {
          routes = { ...routes, [next.identifier]: next };
        }
      }
    }

    return makeGroupProto({
      identifier: g.identifier,
      topLevel: g.topLevel,
      routes,
      groups,
      annotations: stripResolveAnnotations(g.annotations),
    });
  });

/**
 * Resolve every deferred `from` / `effect` / `groupsEffect` on a
 * catalog. `R` is the catalog’s requirements.
 *
 * @internal
 */
export const resolveApi = <
  A extends ApiConstraint,
  R = A extends Api<infer _Id, infer _G, infer RX, infer _D> ? RX : unknown,
>(
  api: A,
): Effect.Effect<A, never, R> =>
  Effect.gen(function* () {
    const groups: Record<string, GroupTop> = {};
    for (const [id, g] of Object.entries(api.groups)) {
      groups[id] = yield* resolveGroup(g);
    }

    const fromGroups = Context.getOption(api.annotations, FromGroups);
    if (Option.isSome(fromGroups)) {
      for (const g of yield* fromGroups.value) {
        groups[g.identifier] = yield* resolveGroup(g);
      }
    }

    return makeAppProto({
      identifier: api.identifier,
      groups,
      annotations: Context.omit(FromGroups)(
        api.annotations,
      ) as Context.Context<never>,
    }) as unknown as A;
  }) as Effect.Effect<A, never, R>;

/** True when a group still has deferred destinations to resolve. @internal */
export const hasDeferredDestinations = (g: GroupTop): boolean =>
  Option.isSome(Context.getOption(g.annotations, FromRoutes)) ||
  Option.isSome(Context.getOption(g.annotations, FromEffect));

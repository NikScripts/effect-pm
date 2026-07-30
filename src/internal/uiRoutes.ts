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
import { HttpApi } from "effect/unstable/httpapi";
import type { HttpApiGroup } from "effect/unstable/httpapi";
import type * as Schema from "effect/Schema";
import type { AsRoutesEffect } from "./asRoutesBrand";
import * as uiRoute from "./uiRoute";
import type { Path } from "./uiRoute";

export type { AsRoutesEffect } from "./asRoutesBrand";

export const TypeId = "~hyperlink-ts/ui/Route/Api" as const;
export const GroupTypeId = "~hyperlink-ts/ui/Route/Group" as const;

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
 * Erased group shape (runtime + nested-group bound). Avoids a circular
 * `Group.Constraint` that expands through itself.
 */
export interface GroupTop extends Pipeable {
  readonly [GroupTypeId]: typeof GroupTypeId;
  readonly identifier: string;
  readonly topLevel: boolean;
  readonly routes: Readonly<Record<string, uiRoute.Constraint>>;
  readonly groups: Readonly<Record<string, GroupTop>>;
  readonly annotations: Context.Context<never>;
  add(...items: ReadonlyArray<uiRoute.Constraint | GroupTop>): GroupTop;
  /**
   * Merge destinations from an Effect (`HttpRouter.addAll` analogue).
   * Prefer {@link ../Group.asRoutes} — typed UrlBuilder items are preserved.
   */
  fromEffect(
    effect: Effect.Effect<Iterable<RouteLike>, never, never>,
  ): GroupTop;
  prefix(prefix: Path): GroupTop;
  annotate<I, S>(tag: Context.Key<I, S>, value: S): GroupTop;
}

/**
 * Nested group of destinations — `HttpApiGroup` analogue, plus nested groups.
 */
export interface Group<
  out Id extends string = string,
  in out Routes extends uiRoute.Constraint = never,
  in out Groups extends GroupTop = never,
  out TopLevel extends boolean = boolean,
> extends GroupTop {
  readonly identifier: Id;
  readonly topLevel: TopLevel;
  readonly routes: RouteMap<Routes>;
  readonly groups: GroupMap<Groups>;
  add<const A extends ReadonlyArray<uiRoute.Constraint | GroupTop>>(
    ...items: A
  ): Group<
    Id,
    Routes | Extract<A[number], uiRoute.Constraint>,
    Groups | Extract<A[number], GroupTop>,
    TopLevel
  >;
  /**
   * Merge destinations from {@link ../Group.asRoutes} (or any {@link AsRoutesEffect}).
   * Preserves item identifiers for {@link UrlBuilder}.
   */
  fromEffect<Items extends RouteLike>(
    effect: AsRoutesEffect<Items>,
  ): Group<
    Id,
    Routes | Extract<Items, uiRoute.Constraint>,
    Groups | Extract<Items, GroupTop>,
    TopLevel
  >;
  fromEffect(
    effect: Effect.Effect<Iterable<RouteLike>, never, never>,
  ): GroupTop;
  prefix(prefix: Path): Group<Id, Routes, Groups, TopLevel>;
  annotate<I, S>(
    tag: Context.Key<I, S>,
    value: S,
  ): Group<Id, Routes, Groups, TopLevel>;
}

export declare namespace Group {
  export type Constraint = GroupTop;
}

/** @deprecated Use {@link Group.Constraint} */
export type GroupConstraint = Group.Constraint;

/**
 * Route catalog — `HttpApi` analogue.
 */
export interface Api<
  out Id extends string = string,
  in out Groups extends GroupTop = never,
> extends Pipeable {
  readonly [TypeId]: typeof TypeId;
  readonly identifier: Id;
  readonly groups: GroupMap<Groups>;
  readonly annotations: Context.Context<never>;
  add<const A extends ReadonlyArray<uiRoute.Constraint | GroupTop>>(
    ...items: A
  ): Api<Id, MergeApiAddsFromTuple<Groups, A>>;
  addHttpApi<Id2 extends string, ApiGroups extends HttpApiGroup.Constraint>(
    api: HttpApi.HttpApi<Id2, ApiGroups>,
  ): Api<Id, MergeApiAdds<Groups, GroupTop>>;
  prefix(prefix: Path): Api<Id, Groups>;
  annotate<I, S>(tag: Context.Key<I, S>, value: S): Api<Id, Groups>;
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
  add(...items: ReadonlyArray<RouteLike>): ApiConstraint;
  addHttpApi<Id2 extends string, ApiGroups extends HttpApiGroup.Constraint>(
    api: HttpApi.HttpApi<Id2, ApiGroups>,
  ): ApiConstraint;
  prefix(prefix: Path): ApiConstraint;
  annotate<I, S>(tag: Context.Key<I, S>, value: S): ApiConstraint;
}

export declare namespace Api {
  export type Constraint = ApiConstraint;
}

/** @deprecated Use {@link Api.Constraint} */
export type AppConstraint = Api.Constraint;

export type RouteLike = uiRoute.Constraint | GroupTop;

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

const groupProto = {
  pipe() {
    // Effect Pipeable protocol — `arguments` is required by `pipeArguments`.
    // eslint-disable-next-line prefer-rest-params -- pipeArguments(this, arguments)
    return pipeArguments(this, arguments);
  },
  add(this: GroupTop, ...items: ReadonlyArray<RouteLike>): GroupTop {
    let routes = { ...this.routes } as Record<string, uiRoute.Constraint>;
    let groups = { ...this.groups } as Record<string, GroupTop>;
    for (const item of items) {
      if (uiRoute.isRoute(item)) {
        routes = { ...routes, [item.identifier]: item };
      } else {
        groups = { ...groups, [item.identifier]: item };
      }
    }
    return makeGroupProto({
      identifier: this.identifier,
      topLevel: this.topLevel,
      routes,
      groups,
      annotations: this.annotations,
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
    return makeGroupProto({
      identifier: this.identifier,
      topLevel: this.topLevel,
      routes,
      groups,
      annotations: this.annotations,
    });
  },
  annotate<I, S>(
    this: GroupTop,
    tag: Context.Key<I, S>,
    value: S,
  ): GroupTop {
    return makeGroupProto({
      identifier: this.identifier,
      topLevel: this.topLevel,
      routes: this.routes,
      groups: this.groups,
      annotations: Context.add(this.annotations, tag, value),
    });
  },
  fromEffect(
    this: GroupTop,
    effect: Effect.Effect<Iterable<RouteLike>, never, never>,
  ): GroupTop {
    const items = Array.from(Effect.runSync(effect));
    return this.add(...items);
  },
};

const makeGroupProto = (options: {
  readonly identifier: string;
  readonly topLevel: boolean;
  readonly routes: Readonly<Record<string, uiRoute.Constraint>>;
  readonly groups: Readonly<Record<string, GroupTop>>;
  readonly annotations: Context.Context<never>;
}): GroupTop =>
  Object.assign(Object.create(groupProto), {
    [GroupTypeId]: GroupTypeId,
    identifier: options.identifier,
    topLevel: options.topLevel,
    routes: options.routes,
    groups: options.groups,
    annotations: options.annotations,
  }) as GroupTop;

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

const mergeTopLevel = (existing: GroupTop, item: GroupTop): GroupTop =>
  existing.add(...Object.values(item.routes), ...Object.values(item.groups));

const appProto = {
  pipe() {
    // Effect Pipeable protocol — `arguments` is required by `pipeArguments`.
    // eslint-disable-next-line prefer-rest-params -- pipeArguments(this, arguments)
    return pipeArguments(this, arguments);
  },
  add(this: ApiConstraint, ...items: ReadonlyArray<RouteLike>): ApiConstraint {
    let groups = { ...this.groups } as Record<string, GroupTop>;
    for (const item of items) {
      if (uiRoute.isRoute(item)) {
        const id = "__top";
        const existing = groups[id] ?? group(id, { topLevel: true });
        groups = { ...groups, [id]: existing.add(item) };
      } else if (item.topLevel) {
        const id = "__top";
        const existing = groups[id] ?? group(id, { topLevel: true });
        const merged = mergeTopLevel(existing, item);
        // Keep annotations when merging groups.
        groups = {
          ...groups,
          [id]: makeGroupProto({
            identifier: merged.identifier,
            topLevel: merged.topLevel,
            routes: merged.routes,
            groups: merged.groups,
            annotations: Context.merge(merged.annotations, item.annotations),
          }),
        };
      } else {
        groups = { ...groups, [item.identifier]: item };
      }
    }
    return makeAppProto({
      identifier: this.identifier,
      groups,
      annotations: this.annotations,
    });
  },
  addHttpApi<Id extends string, Groups extends HttpApiGroup.Constraint>(
    this: ApiConstraint,
    api: HttpApi.HttpApi<Id, Groups>,
  ): ApiConstraint {
    return this.add(addHttpApi(api));
  },
  prefix(this: ApiConstraint, prefix: Path): ApiConstraint {
    const groups: Record<string, GroupTop> = {};
    for (const [id, g] of Object.entries(this.groups)) {
      groups[id] = g.prefix(prefix);
    }
    return makeAppProto({
      identifier: this.identifier,
      groups,
      annotations: this.annotations,
    });
  },
  annotate<I, S>(
    this: ApiConstraint,
    tag: Context.Key<I, S>,
    value: S,
  ): ApiConstraint {
    return makeAppProto({
      identifier: this.identifier,
      groups: this.groups,
      annotations: Context.add(this.annotations, tag, value),
    });
  },
};

const makeAppProto = (options: {
  readonly identifier: string;
  readonly groups: Readonly<Record<string, GroupTop>>;
  readonly annotations: Context.Context<never>;
}): ApiConstraint =>
  Object.assign(Object.create(appProto), {
    [TypeId]: TypeId,
    identifier: options.identifier,
    groups: options.groups,
    annotations: options.annotations,
  }) as ApiConstraint;

/** Empty catalog — `HttpApi.make` analogue. */
export const make = <const Id extends string>(identifier: Id): Api<Id, never> =>
  makeAppProto({
    identifier,
    groups: {},
    annotations: Context.empty(),
  }) as unknown as Api<Id, never>;

/**
 * Import an Effect `HttpApi` path tree as a top-level {@link group} bundle
 * (`HttpApi.addHttpApi` analogue for URL surface only).
 */
export const addHttpApi = <
  Id extends string,
  Groups extends HttpApiGroup.Constraint,
>(
  api: HttpApi.HttpApi<Id, Groups>,
): GroupTop => {
  const buckets = new Map<
    string,
    { readonly topLevel: boolean; ends: Array<uiRoute.Constraint> }
  >();

  HttpApi.reflect(api, {
    onGroup({ group: g }) {
      if (!buckets.has(g.identifier)) {
        buckets.set(g.identifier, { topLevel: g.topLevel, ends: [] });
      }
    },
    onEndpoint({ group: g, endpoint }) {
      const path = endpoint.path;
      if (typeof path !== "string" || !path.startsWith("/") || path === "*") {
        return;
      }
      let bucket = buckets.get(g.identifier);
      if (bucket === undefined) {
        bucket = { topLevel: g.topLevel, ends: [] };
        buckets.set(g.identifier, bucket);
      }
      const params = endpoint.params as Schema.Top | undefined;
      bucket.ends.push(
        uiRoute.get(endpoint.identifier, path as Path, { params }),
      );
    },
  });

  let bag: GroupTop = group(api.identifier, { topLevel: true });
  for (const [id, bucket] of buckets) {
    if (bucket.ends.length === 0) continue;
    if (bucket.topLevel) {
      bag = bag.add(...bucket.ends);
    } else {
      bag = bag.add(group(id).add(...bucket.ends));
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
        path: route.path,
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

  if (normalized === "/") return Option.none();

  let best: Match | undefined;
  let bestScore = -1;

  for (const entry of flatten(self)) {
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

/** Loose builder for erased / runtime contexts. */
export type UrlMethodLoose = (
  ...args: ReadonlyArray<string | UrlQueryOptions>
) => string;

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

/** Call args: positional path segments, optional `{ query }` last. */
type UrlMethodArgs<Keys extends readonly string[]> = Keys extends readonly []
  ? [] | [options: UrlQueryOptions]
  : PathArgTuple<Keys> | [...PathArgTuple<Keys>, options: UrlQueryOptions];

type UrlMethod<E extends uiRoute.Constraint> = E extends
  uiRoute.Route<string, infer PathType, infer _Params>
  ? (...args: UrlMethodArgs<PathKeys<PathType>>) => string
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

type EndpointsOfGroup<G> = G extends Group<string, infer Routes, infer _N, infer _T>
  ? Routes
  : never;

type NestedOfGroup<G> = G extends Group<string, infer _R, infer Nested, infer _T>
  ? Nested
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
  Api<infer _Id, infer Groups> ? Simplify<
    TopLevelMethods<Extract<Groups, { readonly topLevel: true }>> &
      NestedBuilders<Groups>
  >
  : UrlBuilderLoose;

/** Nested URL builder — positional path args + optional `{ query }`. */
export const urlBuilder = <A extends ApiConstraint>(
  self: A,
  options?: { readonly baseUrl?: URL | string | undefined },
): UrlBuilder<A> => {
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
    const method: UrlMethodLoose = (...args) => {
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
    };
    setCallable(cursor, leafId, method);
  };

  for (const entry of flatten(self)) {
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

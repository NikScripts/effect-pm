/**
 * @module Route
 *
 * UI route **catalog** — Effect HttpApi-shaped declarations anyone can use:
 *
 * | Effect | Route |
 * |--------|--------|
 * | `HttpApi.make` | {@link make} |
 * | `HttpApiGroup.make` | {@link group} |
 * | `HttpApiEndpoint.get` | {@link get} |
 * | endpoint handler | {@link handle} → {@link ./Router.Outlet} |
 * | `HttpApiClient.urlBuilder` | {@link urlBuilder} |
 *
 * Declare path + handler. {@link ./Router} matches the URL and
 * {@link ./Router.Outlet} renders the matched {@link handle}.
 *
 * ```ts
 * const site = Route.make("site").add(
 *   Route.get("home", "/home").pipe(Route.handle(() => <Home />)),
 *   Route.get("user", "/users/:id").pipe(
 *     Route.params(Schema.Struct({ id: Schema.String })),
 *     Route.handle(({ params }) => <User id={params.id} />),
 *   ),
 *   Route.group("hub", { topLevel: true }).effect(Group.asRoutes(ServicesHub)),
 * )
 *
 * Route.urlBuilder(site).home()
 * Route.urlBuilder(site).user("42", { query: { tab: "bio" } })
 * // Last.provider(History.fromApi(site)) — or Memory.fromApi / Waku.fromApi
 * // <Router.Outlet /> renders the matched handle
 * ```
 *
 * Path params are **positional** on {@link urlBuilder} (`urls.user("42")`);
 * pass `{ query }` last when you need `?x=y`.
 *
 * @see docs/handoffs/ui-routes-dream.md
 */
import * as Context from "effect/Context";
import { dual } from "effect/Function";
import type * as Option from "effect/Option";
import type * as Schema from "effect/Schema";
import type { HttpApi, HttpApiGroup } from "effect/unstable/httpapi";
import type { ReactNode } from "react";
import type * as pageModule from "./Page";
import * as pageMint from "./internal/pageMint";
import * as endpoint from "./internal/route";
import * as fileRouter from "./internal/fileRouter";
import * as catalog from "./internal/routes";

// =============================================================================
// Handler (what to render — real router)
// =============================================================================

/**
 * Loose args passed to a route {@link handle} / Outlet when schemas are erased.
 * Prefer {@link PageProps} / {@link PagePropsFrom} for typed pages.
 *
 * @public
 */
export type HandleArgs = {
  readonly params: Record<string, string>;
  /** Decoded `?` query pairs (empty object when none). */
  readonly query: Record<string, string>;
  readonly pathname: string;
  /** `pathname` + search (`/users/1?tab=bio`). */
  readonly href: string;
};

/**
 * Typed page props from an endpoint (params/query schemas + pathname/href).
 *
 * @public
 */
export type PagePropsFrom<E> = endpoint.pageSuccess.PagePropsFromEndpoint<E>;

/**
 * Typed page props from a catalog path: `PageProps<typeof Site, "app", "home">`.
 *
 * @public
 */
export type PageProps<
  Api extends {
    readonly groups: Record<
      string,
      { readonly routes: Record<string, unknown> }
    >;
  },
  GroupId extends keyof Api["groups"] & string,
  EndpointId extends keyof Api["groups"][GroupId]["routes"] & string,
> = endpoint.pageSuccess.PageProps<Api, GroupId, EndpointId>;

/**
 * Render function for a matched destination (`HttpApiBuilder.handle` analogue for UI).
 *
 * @public
 */
export type Handle = (args: HandleArgs) => ReactNode;

/**
 * Handler annotation on a destination. Prefer {@link handle} to attach it.
 *
 * @public
 */
export class Handler extends Context.Service<Handler, Handle>()(
  "last-ts/Route/Handler",
) {}

/**
 * Attach a render function to a destination. Dual.
 *
 * @deprecated Prefer {@link ./RouterBuilder.group} handlers + layout. Kept for
 * catalogs that still annotate destinations directly.
 *
 * ```ts
 * Route.get("home", "/home").pipe(Route.handle(() => <Home />))
 * ```
 *
 * @public
 */
export const handle: {
  (fn: Handle): <E extends Constraint>(self: E) => E;
  <E extends Constraint>(self: E, fn: Handle): E;
} = dual(2, <E extends Constraint>(self: E, fn: Handle): E =>
  self.annotate(Handler, fn) as E,
);

/**
 * Read {@link Handler} from a match (if the destination used {@link handle}).
 *
 * @public
 */
export const handleOf = (hit: Match | undefined): Handle | undefined =>
  hit === undefined
    ? undefined
    : Context.getOrUndefined(hit.annotations, Handler);

/** Absolute pathname template (`/health`, `/users/:id`). @public */
export type Path = endpoint.Path;

/**
 * Declared destination — `HttpApiEndpoint.get` with Page success by default.
 *
 * @public
 */
export type Endpoint<
  Id extends string = string,
  PathType extends Path = Path,
  Params extends Schema.Top = never,
  Query extends Schema.Top = never,
> = endpoint.Route<Id, PathType, Params, Query>;

/** @deprecated Use {@link Endpoint}. @public */
export type Route<
  Id extends string = string,
  PathType extends Path = Path,
  Params extends Schema.Top = never,
  Query extends Schema.Top = never,
> = Endpoint<Id, PathType, Params, Query>;

/** @public */
export type Constraint = endpoint.Constraint;

/** @public */
export const isEndpoint: (u: unknown) => u is Constraint = endpoint.isRoute;

/** @deprecated Use {@link isEndpoint}. @public */
export const isRoute = isEndpoint;

/**
 * Page success schema (`text/html` peer of Json) — default for {@link get}.
 *
 * @public
 */
export const Page: typeof endpoint.pageSuccess.Page = endpoint.pageSuccess.Page;

/**
 * Declare a page destination (`HttpApiEndpoint.get` + Page success schema).
 *
 * Catalog path declaration — fileRouter owns disk paths for Page mints.
 * Render mode: {@link static_} / `Page.static`. Never `getConfig`.
 *
 * @public
 */
export const get: typeof endpoint.get = endpoint.get;

/** Shared with {@link ./Page.make}. @public */
export type RequestOptions = endpoint.RequestOptions;

/**
 * Mark an existing {@link ./Page} mint as static mode.
 *
 * Class form: define the class, then pipe (not inside `extends`):
 * `export const aboutStatic = About.pipe(Route.static)`.
 *
 * @public
 */
export const static_: <P extends pageModule.AnyPage>(
  self: P,
) => pageModule.AnyPage<P["options"], "static"> = pageMint.remintStatic;

export { static_ as static };

/**
 * Attach a params schema. Dual.
 *
 * @public
 */
export const params: typeof endpoint.params = endpoint.params;

/**
 * Prefix a destination path.
 *
 * @public
 */
export const prefix = <E extends Constraint>(
  self: E,
  prefixPath: Path,
): Constraint => self.prefix(prefixPath);

/**
 * Annotate a destination.
 *
 * @public
 */
export const annotate = <E extends Constraint, I, S>(
  self: E,
  tag: Context.Key<I, S>,
  value: S,
): E => self.annotate(tag, value) as E;

/** Join two absolute path templates. @public */
export const joinPath: (prefix: Path | "/", path: Path | "/") => Path =
  endpoint.joinPath;

/** Compile a path template for match / build. @public */
export const compilePath: typeof endpoint.compilePath = endpoint.compilePath;

// =============================================================================
// Group (`HttpApiGroup`)
// =============================================================================

/**
 * Nested group of destinations — `HttpApiGroup` analogue (+ nested groups).
 * `R` = requirements from `from` / `effect`.
 *
 * @public
 */
export type Group<
  Id extends string = string,
  Routes extends Constraint = never,
  Groups extends catalog.GroupTop = never,
  TopLevel extends boolean = boolean,
  R = never,
> = catalog.Group<Id, Routes, Groups, TopLevel, R>;

/** Erased group constraint (nested catalogs / `effect`). @public */
export type GroupTop = catalog.GroupTop;

/** Erased catalog constraint. @public */
export type ApiConstraint = catalog.ApiConstraint;

/**
 * Named group (`HttpApiGroup.make`). Pass `topLevel: true` so child methods
 * flatten onto the parent URL builder.
 *
 * `group.effect(Effect.gen(…))` always defers; destinations + `R` surface
 * on {@link ./RouterBuilder.layer}. Item types stay for {@link urlBuilder}.
 *
 * @public
 */
export const group: typeof catalog.group = catalog.group;

/** @public */
export const isGroup: (u: unknown) => u is catalog.GroupTop = catalog.isGroup;

// =============================================================================
// Api (`HttpApi`)
// =============================================================================

/**
 * Route catalog — `HttpApi` analogue. Generics preserved through `.add`.
 * `R` = requirements (`effect` / `groupsEffect` / `from`).
 *
 * @public
 */
export type Api<
  Id extends string = string,
  Groups extends catalog.GroupTop = never,
  R = never,
  DeferredGroups extends catalog.GroupTop = never,
> = catalog.Api<Id, Groups, R, DeferredGroups>;

export declare namespace Api {
  /** Requirements for a catalog (`RouterBuilder.layer` `R`). */
  export type Context<A> = catalog.Api.Context<A>;
  /** Groups from {@link catalog.Api.groupsEffect} only. */
  export type DeferredGroups<A> = catalog.Api.DeferredGroups<A>;
}

/** Destination or group — what `.add` accepts. @public */
export type RouteLike = catalog.RouteLike;

/** @public */
export const isApi: (u: unknown) => u is catalog.ApiConstraint = catalog.isApi;

/**
 * Empty catalog (`HttpApi.make`).
 *
 * @public
 */
export const make: typeof catalog.make = catalog.make;

/**
 * Turn an Effect `HttpApi` into a top-level group bundle for {@link Api.add}
 * (`HttpApi.addHttpApi` analogue — **URL surface only**).
 *
 * Prefer mixing peers on the catalog / group:
 * - `Router.make("site").add(HttpApiGroup.make(...), Router.group(...))`
 * - `Router.group("pages").add(Route.get(...), HttpApiEndpoint.get(...))`
 * - `Router.make("site").addHttpApi(api)` (spreads each `HttpApiGroup`)
 *
 * @public
 */
export const addHttpApi: <
  Id extends string,
  Groups extends HttpApiGroup.Constraint,
>(
  api: HttpApi.HttpApi<Id, Groups>,
) => catalog.GroupTop = catalog.addHttpApi;

/** Flattened match hit. @public */
export type Match = catalog.Match;

/**
 * Match a pathname against a catalog (longest template wins).
 *
 * @public
 */
export const match: (
  self: catalog.ApiConstraint,
  pathname: string,
) => Option.Option<Match> = catalog.match;

/**
 * Typed URL builder for a catalog — path segments as args, optional `{ query }`.
 *
 * @example
 * ```ts
 * urls.home()
 * urls.node("app/NodeA")
 * urls.search({ query: { q: "WorkPool" } })
 * urls.api.symbol("effect", "Effect", "succeed", { query: { src: "1" } })
 * ```
 *
 * @public
 */
export type UrlBuilder<A extends catalog.ApiConstraint = catalog.ApiConstraint> =
  catalog.UrlBuilder<A>;

/** Loose builder when the catalog type is erased. @public */
export type UrlBuilderLoose = catalog.UrlBuilderLoose;

/** Erased url method (`...pathArgs`, optional `{ query }`). @public */
export type UrlMethodLoose = catalog.UrlMethodLoose;

/** Trailing `{ query }` options for {@link urlBuilder} methods. @public */
export type UrlQueryOptions = catalog.UrlQueryOptions;

/**
 * Typed union of catalog paths (`/docs/:slug` → `` `/docs/${string}` ``).
 * Closed over by {@link ./Router.link}`(catalog)`.
 *
 * @public
 */
export type PathsOf<A> = catalog.PathsOf<A>;

/**
 * Path (+ optional `?query`) from a {@link urlBuilder} method for one template.
 *
 * @public
 */
export type PathHref<Path extends string> = catalog.PathHref<Path>;

/**
 * {@link ./Router.link} `to` value: {@link PathsOf} literal or the same with
 * `?query` (urlBuilder output). Never bare `string` — use `out` for free-form.
 *
 * @public
 */
export type ToHref<A> = catalog.ToHref<A>;

/** Expand path params in a template to `${string}` slots. @public */
export type InstantiatePath<P extends string> = catalog.InstantiatePath<P>;

/**
 * Build the typed URL surface for a catalog.
 *
 * Path params are positional (template order). Pass `{ query }` last for `?x=y`.
 * Pass `{ baseUrl }` to prefix absolute URLs.
 *
 * @public
 */
export const urlBuilder: <A extends catalog.ApiConstraint>(
  self: A,
  options?: { readonly baseUrl?: URL | string | undefined },
) => UrlBuilder<A> = catalog.urlBuilder;

/** Walk groups/endpoints (tooling) — `HttpApi.reflect` analogue. @public */
export const reflect: typeof catalog.reflect = catalog.reflect;

/** Flat list of navigable paths (tests / debugging). @public */
export const flatten: typeof catalog.flatten = catalog.flatten;

// =============================================================================
// File router (codegen path table → catalog)
// =============================================================================

/**
 * Named group over a typed file-router table (`paths.gen` entries).
 *
 * ```ts
 * Route.fileSystem("docs", fileEntries, { topLevel: true })
 * ```
 *
 * @public
 */
export const fileSystem: typeof fileRouter.routeFileSystem =
  fileRouter.routeFileSystem;

/**
 * `root` + `topLevel: true` over a typed file-router table.
 *
 * ```ts
 * Route.make("app").add(Route.fileRoot(fileEntries))
 * ```
 *
 * @public
 */
export const fileRoot: typeof fileRouter.fileRoot = fileRouter.fileRoot;

// =============================================================================
// asRoutes brand (shared with hyperlink Group.asRoutes)
// =============================================================================

export {
  AsRoutesTypeId,
  isAsRoutesBrand,
  type AsRoutesBrand,
  type AsRoutesEffect,
  type RouteGroup,
} from "./internal/asRoutesBrand";
/** Type-only — `declare const` phantom; must not be a runtime re-export. */
export type { AsRoutesItems } from "./internal/asRoutesBrand";

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
 *   Route.group("hub", { topLevel: true }).fromEffect(Group.asRoutes(ServicesHub)),
 * )
 *
 * Route.urlBuilder(site).home()
 * Route.urlBuilder(site).user("42", { query: { tab: "bio" } })
 * Router.history(site)
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
import * as endpoint from "./internal/route";
import * as fileRouter from "./internal/fileRouter";
import * as catalog from "./internal/routes";

// =============================================================================
// Handler (what to render — real router)
// =============================================================================

/**
 * Args passed to a route {@link handle} when {@link ./Router.Outlet} renders a match.
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
 * ```ts
 * Route.get("home", "/home").pipe(Route.handle(() => <Home />))
 * ```
 *
 * @public
 */
export const handle: {
  (fn: Handle): <Id extends string, PathType extends Path, Params>(
    self: Endpoint<Id, PathType, Params>,
  ) => Endpoint<Id, PathType, Params>;
  <Id extends string, PathType extends Path, Params>(
    self: Endpoint<Id, PathType, Params>,
    fn: Handle,
  ): Endpoint<Id, PathType, Params>;
} = dual(
  2,
  <Id extends string, PathType extends Path, Params>(
    self: Endpoint<Id, PathType, Params>,
    fn: Handle,
  ): Endpoint<Id, PathType, Params> => self.annotate(Handler, fn),
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
 * Declared destination — `HttpApiEndpoint` analogue.
 *
 * @public
 */
export interface Endpoint<
  out Id extends string = string,
  out PathType extends Path = Path,
  out Params = never,
> extends endpoint.Route<Id, PathType, Params> {}

/** @deprecated Use {@link Endpoint}. @public */
export type Route<
  Id extends string = string,
  PathType extends Path = Path,
  Params = never,
> = Endpoint<Id, PathType, Params>;

/** @public */
export type Constraint = endpoint.Constraint;

/** @public */
export const isEndpoint: (u: unknown) => u is Constraint = endpoint.isRoute;

/** @deprecated Use {@link isEndpoint}. @public */
export const isRoute = isEndpoint;

/**
 * Declare a destination (`HttpApiEndpoint.get`).
 *
 * @public
 */
export const get: <const Id extends string, const PathType extends Path>(
  identifier: Id,
  path: PathType,
  options?: {
    readonly params?: Schema.Top | undefined;
  },
) => Endpoint<Id, PathType> = endpoint.get;

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
export const prefix = <Id extends string, PathType extends Path, Params>(
  self: Endpoint<Id, PathType, Params>,
  prefixPath: Path,
): Endpoint<Id, Path, Params> => self.prefix(prefixPath);

/**
 * Annotate a destination.
 *
 * @public
 */
export const annotate = <Id extends string, PathType extends Path, Params, I, S>(
  self: Endpoint<Id, PathType, Params>,
  tag: Context.Key<I, S>,
  value: S,
): Endpoint<Id, PathType, Params> => self.annotate(tag, value);

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
 *
 * @public
 */
export type Group<
  Id extends string = string,
  Routes extends Constraint = never,
  Groups extends catalog.GroupTop = never,
  TopLevel extends boolean = boolean,
> = catalog.Group<Id, Routes, Groups, TopLevel>;

/** Erased group constraint (nested catalogs / `fromEffect`). @public */
export type GroupTop = catalog.GroupTop;

/** Erased catalog constraint. @public */
export type ApiConstraint = catalog.ApiConstraint;

/**
 * Named group (`HttpApiGroup.make`). Pass `topLevel: true` so child methods
 * flatten onto the parent URL builder. Dynamic children:
 * `Route.group("hub", { topLevel: true }).fromEffect(Group.asRoutes(ServicesHub))`.
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
 *
 * @public
 */
export type Api<
  Id extends string = string,
  Groups extends catalog.GroupTop = never,
> = catalog.Api<Id, Groups>;

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
  AsRoutesItems,
  isAsRoutesBrand,
  type AsRoutesBrand,
  type AsRoutesEffect,
  type RouteGroup,
} from "./internal/asRoutesBrand";

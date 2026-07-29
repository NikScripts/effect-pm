/**
 * @module ui/Route
 *
 * Public URL / UI router — **Effect HttpApi shape**:
 *
 * | Effect | Route |
 * |--------|--------|
 * | `HttpApi.make` | {@link make} |
 * | `HttpApiGroup.make` | {@link group} |
 * | `HttpApiEndpoint.get` | {@link get} |
 * | `HttpApi.addHttpApi` | {@link addHttpApi} / {@link Api.addHttpApi} |
 * | `HttpApiClient.urlBuilder` | {@link urlBuilder} |
 * | `HttpApi.reflect` | {@link reflect} |
 *
 * Root endpoints go on {@link make} directly. Optional `topLevel` on
 * {@link group} flattens that group’s endpoints onto the parent builder
 * (HttpApi parity). Mix wire APIs in with {@link addHttpApi}.
 *
 * Generics are preserved through `.add` so {@link urlBuilder} is typed
 * (`urls.app.dashboard()`, params required when declared).
 *
 * ```ts
 * import * as Route from "hyperlink-ts/ui/Route"
 * import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
 *
 * const wire = HttpApi.make("wire").add(
 *   HttpApiGroup.make("users", { topLevel: true }).add(
 *     HttpApiEndpoint.get("getUser", "/users/:id"),
 *   ),
 * )
 *
 * const site = Route.make("site").add(
 *   Route.get("home", "/home"),
 *   Route.get("docs", "/docs"),
 *   Route.group("app").add(
 *     Route.get("dashboard", "/app"),
 *   ),
 *   Route.addHttpApi(wire),
 * )
 *
 * Route.urlBuilder(site).home()
 * Route.urlBuilder(site).app.dashboard()
 * Route.match(site, "/users/1")
 * ```
 *
 * @see docs/handoffs/ui-routes-dream.md
 */
import * as Context from "effect/Context";
import type * as Option from "effect/Option";
import type * as Schema from "effect/Schema";
import type { HttpApi, HttpApiGroup } from "effect/unstable/httpapi";
import * as endpoint from "../internal/uiRoute";
import * as catalog from "../internal/uiRoutes";

// =============================================================================
// Target annotation (Group dashboard / typed destinations)
// =============================================================================

/**
 * Destination metadata stamped on catalog endpoints (esp. Group-built dashboards).
 * {@link ./Router} reads this from {@link Match.annotations} for `selected` / `view`.
 *
 * @public
 */
export class Target extends Context.Service<
  Target,
  {
    readonly keys: ReadonlyArray<string>;
    readonly member: unknown | null;
    readonly view: string | undefined;
    readonly kind: "group" | "leaf" | "leafView" | "health";
  }
>()("hyperlink-ts/ui/Route/Target") {}

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

/**
 * Named group (`HttpApiGroup.make`). Pass `topLevel: true` so child methods
 * flatten onto the parent URL builder.
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
 * Typed URL builder for a catalog (`HttpApiClient.urlBuilder` analogue).
 *
 * @public
 */
export type UrlBuilder<A extends catalog.ApiConstraint = catalog.ApiConstraint> =
  catalog.UrlBuilder<A>;

/** Loose builder when the catalog type is erased. @public */
export type UrlBuilderLoose = catalog.UrlBuilderLoose;

/**
 * Build the typed URL surface for a catalog.
 *
 * @public
 */
export const urlBuilder: <A extends catalog.ApiConstraint>(
  self: A,
) => UrlBuilder<A> = catalog.urlBuilder;

/** Walk groups/endpoints (tooling) — `HttpApi.reflect` analogue. @public */
export const reflect: typeof catalog.reflect = catalog.reflect;

/** Flat list of navigable paths (tests / debugging). @public */
export const flatten: typeof catalog.flatten = catalog.flatten;

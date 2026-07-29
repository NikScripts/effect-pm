/**
 * @module ui/Route
 *
 * Public URL / UI router — **Effect HttpApi shape**:
 *
 * | Effect | Route |
 * |--------|--------|
 * | `HttpApi.make` | {@link make} |
 * | `HttpApiGroup.make` | {@link Group.make} |
 * | `HttpApiEndpoint.get` | {@link get} |
 * | `HttpApi.addHttpApi` | {@link addHttpApi} / {@link Api.addHttpApi} |
 * | `HttpApiClient.urlBuilder` | {@link urlBuilder} |
 * | `HttpApi.reflect` | {@link reflect} |
 *
 * Root endpoints go on {@link make} directly. Optional `topLevel` on
 * {@link Group.make} flattens that group’s endpoints onto the parent builder
 * (HttpApi parity). Mix wire APIs in with {@link addHttpApi}.
 *
 * Runtime creation = the same constructors in ordinary loops — no Group Tag helper.
 *
 * ```ts
 * import * as Route from "hyperlink-ts/ui/Route"
 * import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
 * import { Schema } from "effect"
 *
 * const Wire = HttpApi.make("wire").add(
 *   HttpApiGroup.make("users", { topLevel: true }).add(
 *     HttpApiEndpoint.get("getUser", "/users/:id"),
 *   ),
 * )
 *
 * const Site = Route.make("site").add(
 *   Route.get("home", "/"),
 *   Route.get("docs", "/docs"),
 *   Route.Group.make("app").add(
 *     Route.get("dashboard", "/app"),
 *   ),
 *   Route.addHttpApi(Wire),
 * )
 *
 * Route.urlBuilder(Site).home()
 * Route.urlBuilder(Site).getUser({ params: { id: "1" } })
 * Route.urlBuilder(Site).app.dashboard()
 * Route.match(Site, "/users/1")
 * ```
 *
 * @see docs/handoffs/ui-routes-dream.md
 */
import type * as Context from "effect/Context";
import type * as Option from "effect/Option";
import type * as Schema from "effect/Schema";
import type { HttpApi, HttpApiGroup } from "effect/unstable/httpapi";
import * as endpoint from "../internal/uiRoute";
import * as catalog from "../internal/uiRoutes";

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
 * Nested group of destinations — `HttpApiGroup` analogue.
 *
 * @public
 */
export interface Group extends catalog.GroupConstraint {}

/**
 * `HttpApiGroup` constructors.
 *
 * @public
 */
export const Group: {
  readonly make: <const Id extends string>(
    identifier: Id,
    options?: {
      readonly topLevel?: boolean | undefined;
    },
  ) => Group;
  readonly isGroup: (u: unknown) => u is Group;
} = {
  make: (identifier, options) =>
    catalog.group(identifier, { topLevel: options?.topLevel }),
  isGroup: catalog.isGroup,
};

/**
 * @deprecated Prefer {@link Group.make}.
 * @public
 */
export const group = Group.make;

// =============================================================================
// Api (`HttpApi`)
// =============================================================================

/**
 * Route catalog — `HttpApi` analogue.
 *
 * @public
 */
export interface Api extends catalog.AppConstraint {}

/** Destination or group — what `.add` accepts. @public */
export type RouteLike = catalog.RouteLike;

/** @public */
export const isApi: (u: unknown) => u is Api = catalog.isApi;

/**
 * Empty catalog (`HttpApi.make`).
 *
 * @public
 */
export const make: <const Id extends string>(identifier: Id) => Api =
  catalog.make;

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
) => Group = catalog.addHttpApi;

/** Flattened match hit. @public */
export type Match = catalog.Match;

/**
 * Match a pathname against a catalog (longest template wins).
 *
 * @public
 */
export const match: (
  self: Api,
  pathname: string,
) => Option.Option<Match> = catalog.match;

/** Nested URL builder (`HttpApiClient.urlBuilder`). @public */
export type UrlBuilder = catalog.UrlBuilder;

/** @public */
export const urlBuilder: (self: Api) => UrlBuilder = catalog.urlBuilder;

/** Walk groups/endpoints (tooling) — `HttpApi.reflect` analogue. @public */
export const reflect: typeof catalog.reflect = catalog.reflect;

/** Flat list of navigable paths (tests / debugging). @public */
export const flatten: typeof catalog.flatten = catalog.flatten;

/**
 * @module ui/Route
 *
 * UI routing — **HttpApi-shaped**, one namespace:
 *
 * | HttpApi | Route |
 * |---------|--------|
 * | `HttpApi.make` | {@link make} |
 * | `HttpApiGroup.make` | {@link group} |
 * | `HttpApiEndpoint.get` | {@link get} |
 * | `HttpApiClient.urlBuilder` | {@link urlBuilder} |
 *
 * Most dashboard routes are **not** hand-written here — build them with
 * {@link ./GroupRoute} (`GroupRoute.from`), which only calls these same tools.
 *
 * ```ts
 * import * as Route from "hyperlink-ts/ui/Route"
 * import * as GroupRoute from "hyperlink-ts/ui/GroupRoute"
 * import { Schema } from "effect"
 *
 * const Dashboard = Route.make("dashboard").add(
 *   GroupRoute.from(ServicesHub, {
 *     leaf: (g, ctx) => g.add(...GroupRoute.gets(ctx, "logs", "schedule")),
 *   }),
 *   Route.group("shell", { topLevel: true }).add(
 *     Route.get("health", "/health"),
 *     Route.get("node", "/health/:nodeId").pipe(
 *       Route.params(Schema.Struct({ nodeId: Schema.String })),
 *     ),
 *   ),
 * )
 *
 * Route.urlBuilder(Dashboard).Nwsl.HttpApi.logs()
 * Route.match(Dashboard, "/Nwsl/HttpApi")
 * ```
 *
 * @see docs/handoffs/ui-routes-dream.md
 */
import type * as Context from "effect/Context";
import type * as Option from "effect/Option";
import type * as Schema from "effect/Schema";
import * as endpoint from "../internal/uiRoute";
import * as catalog from "../internal/uiRoutes";

/** Absolute pathname template (`/health`, `/health/:nodeId`). @public */
export type Path = endpoint.Path;

/**
 * Declared destination — `HttpApiEndpoint` analogue.
 *
 * @public
 */
export interface Route<
  out Id extends string = string,
  out PathType extends Path = Path,
  out Params = never,
> extends endpoint.Route<Id, PathType, Params> {}

/** @public */
export type Constraint = endpoint.Constraint;

/** @public */
export const isRoute: (u: unknown) => u is Constraint = endpoint.isRoute;

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
) => Route<Id, PathType> = endpoint.get;

/**
 * Attach a params schema (`:nodeId` ↔ typed object). Dual.
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
  self: Route<Id, PathType, Params>,
  prefixPath: Path,
): Route<Id, Path, Params> => self.prefix(prefixPath);

/**
 * Annotate a destination.
 *
 * @public
 */
export const annotate = <Id extends string, PathType extends Path, Params, I, S>(
  self: Route<Id, PathType, Params>,
  tag: Context.Key<I, S>,
  value: S,
): Route<Id, PathType, Params> => self.annotate(tag, value);

/** Join two absolute path templates. @public */
export const joinPath: (prefix: Path | "/", path: Path | "/") => Path =
  endpoint.joinPath;

/** Compile a path template for match / build. @public */
export const compilePath: typeof endpoint.compilePath = endpoint.compilePath;

// =============================================================================
// Group + catalog (HttpApi / HttpApiGroup)
// =============================================================================

/**
 * Nested group of destinations — optional `path` makes the nest itself
 * navigable (UI extension; HttpApi groups are not path-bearing).
 *
 * @public
 */
export interface Group extends catalog.GroupConstraint {}

/**
 * Route catalog — what `HttpApi.make` is in Effect.
 *
 * @public
 */
export interface Api extends catalog.AppConstraint {}

/** Destination or group — what `.add` accepts. @public */
export type RouteLike = catalog.RouteLike;

/** @public */
export const isGroup: (u: unknown) => u is Group = catalog.isGroup;

/** @public */
export const isApi: (u: unknown) => u is Api = catalog.isApp;

/**
 * Empty catalog (`HttpApi.make`).
 *
 * @public
 */
export const make: <const Id extends string>(identifier: Id) => Api =
  catalog.make;

/**
 * Named group (`HttpApiGroup.make`). Pass `path` so the nest is navigable
 * (`urls.Nwsl()`). Pass `topLevel: true` so child methods flatten onto the
 * parent URL builder (same as HttpApi).
 *
 * @public
 */
export const group = <const Id extends string>(
  identifier: Id,
  options?: {
    readonly path?: Path | undefined;
    readonly topLevel?: boolean | undefined;
  },
): Group =>
  catalog.group(identifier, {
    path: options?.path,
    topLevel: options?.topLevel,
  });

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

/** Walk groups/destinations (tooling). @public */
export const reflect: typeof catalog.reflect = catalog.reflect;

/** Flat list of navigable paths (tests / debugging). @public */
export const flatten: typeof catalog.flatten = catalog.flatten;

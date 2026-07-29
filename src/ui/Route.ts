/**
 * @module ui/Route
 *
 * UI routing toolkit — one namespace (HttpApi-shaped): destinations, nests, app
 * catalog, match, URL builder. **Not** here: reflecting a Hyperlink `Group` into
 * routes — that bridge is {@link ./groupRoute.routes} (Group tree → same builders).
 *
 * ```ts
 * import * as Route from "hyperlink-ts/ui/Route"
 * import { routes as groupRoutes } from "hyperlink-ts/ui"
 * import { Schema } from "effect"
 *
 * const Dashboard = Route.app("dashboard").add(
 *   Route.group("shell", { topLevel: true }).add(
 *     Route.make("health", "/health"),
 *     Route.make("node", "/health/:nodeId").pipe(
 *       Route.params(Schema.Struct({ nodeId: Schema.String })),
 *     ),
 *   ),
 *   groupRoutes(ServicesHub, { leafViews: ["logs", "schedule"] }),
 * )
 *
 * const urls = Route.urlBuilder(Dashboard)
 * urls.health()
 * urls.Nwsl.HttpApi.logs()
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

// =============================================================================
// Path + single destination
// =============================================================================

/** Absolute pathname template (`/health`, `/health/:nodeId`). @public */
export type Path = endpoint.Path;

/**
 * Declared UI destination — stable id, path template, optional params schema.
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

/** `true` when `u` is a destination {@link Route}. @public */
export const isRoute: (u: unknown) => u is Constraint = endpoint.isRoute;

/**
 * Declare a destination.
 *
 * @public
 */
export const make: <const Id extends string, const PathType extends Path>(
  identifier: Id,
  path: PathType,
  options?: {
    readonly params?: Schema.Top | undefined;
  },
) => Route<Id, PathType> = endpoint.make;

/**
 * Attach a params schema (`:nodeId` ↔ typed object). Dual.
 *
 * @public
 */
export const params: typeof endpoint.params = endpoint.params;

/**
 * Prefix the path (`/app` + `/health` → `/app/health`).
 *
 * @public
 */
export const prefix = <Id extends string, PathType extends Path, Params>(
  self: Route<Id, PathType, Params>,
  prefixPath: Path,
): Route<Id, Path, Params> => self.prefix(prefixPath);

/**
 * Annotate a destination (HttpApi-style Context annotations).
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
// Nest + app catalog
// =============================================================================

/**
 * Nested route group — may itself be navigable via {@link group}'s `path`
 * (layout route; HttpApi groups are not path-bearing).
 *
 * @public
 */
export interface Group extends catalog.GroupConstraint {}

/**
 * Route app / catalog (`HttpApi` analogue) — compose with {@link app}.add.
 *
 * @public
 */
export interface App extends catalog.AppConstraint {}

/** Destination or nest — what {@link App.add} / {@link Group.add} accept. @public */
export type RouteLike = catalog.RouteLike;

/** @public */
export const isGroup: (u: unknown) => u is Group = catalog.isGroup;

/** @public */
export const isApp: (u: unknown) => u is App = catalog.isApp;

/**
 * Empty app catalog.
 *
 * @public
 */
export const app: <const Id extends string>(identifier: Id) => App = catalog.app;

/**
 * Named nest. Pass `path` so the nest itself is navigable (`urls.Nwsl()`).
 * Pass `topLevel: true` so child methods flatten onto the parent builder.
 *
 * @public
 */
export const group: <const Id extends string>(
  identifier: Id,
  options?: {
    readonly path?: Path | undefined;
    readonly topLevel?: boolean | undefined;
  },
) => Group = catalog.group;

/** Flattened match hit. @public */
export type Match = catalog.Match;

/**
 * Match a pathname against an app (longest template wins).
 *
 * @public
 */
export const match: (
  self: App,
  pathname: string,
) => Option.Option<Match> = catalog.match;

/** Nested URL builder (HttpApiClient.urlBuilder shape). @public */
export type UrlBuilder = catalog.UrlBuilder;

/**
 * Build nested URL helpers from an app.
 *
 * @public
 */
export const urlBuilder: (self: App) => UrlBuilder = catalog.urlBuilder;

/** Walk nests/destinations (tooling). @public */
export const reflect: typeof catalog.reflect = catalog.reflect;

/** Flat list of navigable paths (tests / debugging). @public */
export const flatten: typeof catalog.flatten = catalog.flatten;

/** Annotate an app. @public */
export const annotateApp = <I, S>(
  self: App,
  tag: Context.Key<I, S>,
  value: S,
): App => self.annotate(tag, value);

/**
 * @module ui/Route
 *
 * A single UI destination — HttpApiEndpoint-shaped (identifier + path + params),
 * without HTTP methods. Compose with {@link ./Routes}.
 *
 * ```ts
 * import * as Route from "hyperlink-ts/ui/Route"
 * import { Schema } from "effect"
 *
 * const Health = Route.make("health", "/health")
 * const Node = Route.make("node", "/health/:nodeId").pipe(
 *   Route.params(Schema.Struct({ nodeId: Schema.String })),
 * )
 * ```
 *
 * @see docs/handoffs/ui-routes-dream.md
 */
import type * as Context from "effect/Context";
import type * as Schema from "effect/Schema";
import * as internal from "../internal/uiRoute";

/** Absolute pathname template (`/health`, `/health/:nodeId`). @public */
export type Path = internal.Path;

/**
 * Declared UI route — stable id, path template, optional params schema.
 *
 * @public
 */
export interface Route<
  out Id extends string = string,
  out PathType extends Path = Path,
  out Params = never,
> extends internal.Route<Id, PathType, Params> {}

/** @public */
export type Constraint = internal.Constraint;

/** `true` when `u` is a {@link Route}. @public */
export const isRoute: (u: unknown) => u is Constraint = internal.isRoute;

/**
 * Declare a route.
 *
 * @public
 */
export const make: <const Id extends string, const PathType extends Path>(
  identifier: Id,
  path: PathType,
  options?: {
    readonly params?: Schema.Top | undefined;
  },
) => Route<Id, PathType> = internal.make;

/**
 * Attach a params schema (`:nodeId` ↔ typed object). Dual.
 *
 * @public
 */
export const params: typeof internal.params = internal.params;

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
 * Annotate the route (HttpApi-style Context annotations).
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
  internal.joinPath;

/** Compile a path template for match / build (mostly for tests / advanced). @public */
export const compilePath: typeof internal.compilePath = internal.compilePath;

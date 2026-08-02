/**
 * Build {@link ../ui/Route} destinations from a Group tree — used by
 * {@link ../Group.asRoutes}. Route/Router stay Group-agnostic; Group owns this bridge.
 *
 * Type-level {@link MembersRouteLikes} mirrors the runtime walk so
 * `fromEffect(Group.asRoutes(hub))` keeps {@link UrlBuilder} typed.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Route from "../ui/Route";
import {
  AsRoutesTypeId,
  type AsRoutesEffect,
  type RouteGroup,
} from "./asRoutesBrand";
export type { RouteGroup } from "./asRoutesBrand";
export type { AsRoutesEffect } from "./asRoutesBrand";
export { AsRoutesTypeId } from "./asRoutesBrand";

export type AsRoutesOptions = {
  /** Include `/health` + `/health/*nodeId` (default `true`). */
  readonly health?: boolean | undefined;
};

/** Leaf destinations generated for one Group member name. */
export type LeafRouteLikes<K extends string> =
  | Route.Endpoint<K, `/${string}`>
  | Route.Endpoint<`${K}Logs`, `/${string}`>
  | Route.Endpoint<`${K}Schedule`, `/${string}`>;

type NestedGroupRouteLike<
  Id extends string,
  M extends Record<string, unknown>,
  Depth extends ReadonlyArray<unknown>,
> = Route.Group<
  Id,
  | Route.Endpoint<"index", `/${string}`>
  | Extract<MembersRouteLikes<M, Depth>, Route.Constraint>,
  Extract<MembersRouteLikes<M, Depth>, Route.GroupTop>,
  false
>;

/**
 * Union of {@link RouteLike}s for a members record (finite depth).
 * Mirrors {@link membersToRoutes}.
 */
export type MembersRouteLikes<
  M extends Record<string, unknown>,
  Depth extends ReadonlyArray<unknown> = [unknown, unknown, unknown, unknown],
> = Depth extends readonly [unknown, ...infer Rest]
  ? {
      [K in keyof M & string]: M[K] extends {
        readonly members: infer Nested extends Record<string, unknown>;
      } ? NestedGroupRouteLike<K, Nested, Rest>
      : LeafRouteLikes<K>;
    }[keyof M & string]
  : never;

/** `/health` + `/health/*nodeId` when `health` is not false. */
export type HealthRouteLikes =
  | Route.Endpoint<"health", "/health">
  | Route.Endpoint<"nodeHealth", "/health/*nodeId", { readonly nodeId: string }>;

export type AsRoutesItemsOf<
  M extends Record<string, unknown>,
  WithHealth extends boolean = true,
> =
  | (WithHealth extends false ? never : HealthRouteLikes)
  | MembersRouteLikes<M>;

const isGroupNode = (x: unknown): x is RouteGroup =>
  (typeof x === "object" || typeof x === "function") &&
  x !== null &&
  "members" in x;

/** Encode each `/`-separated piece so keys may embed slashes (node ids). */
const encodeKey = (key: string): string =>
  key.split("/").map(encodeURIComponent).join("/");

const formatPath = (keys: ReadonlyArray<string>): Route.Path => {
  const href =
    keys.length === 0 ? "/" : `/${keys.map(encodeKey).join("/")}`;
  return href as Route.Path;
};

const target = <Id extends string, PathType extends Route.Path, Params>(
  endpoint: Route.Endpoint<Id, PathType, Params>,
  value: Route.TargetValue,
): Route.Endpoint<Id, PathType, Params> =>
  Route.annotate(endpoint, Route.Target, value);

const membersToRoutes = (
  node: RouteGroup,
  prefix: ReadonlyArray<string>,
): Array<Route.RouteLike> => {
  const out: Array<Route.RouteLike> = [];
  for (const [name, member] of Object.entries(node.members)) {
    const keys = [...prefix, name];
    const path = formatPath(keys);
    if (isGroupNode(member)) {
      out.push(
        Route.group(name).add(
          target(Route.get("index", path), {
            _tag: "Group",
            keys,
            member,
          }),
          ...membersToRoutes(member, keys),
        ),
      );
    } else {
      out.push(
        target(Route.get(name, path), {
          _tag: "Leaf",
          keys,
          member,
        }),
        target(Route.get(`${name}Logs`, formatPath([...keys, "logs"])), {
          _tag: "LeafView",
          keys: [...keys, "logs"],
          member,
          view: "logs",
        }),
        target(Route.get(`${name}Schedule`, formatPath([...keys, "schedule"])), {
          _tag: "LeafView",
          keys: [...keys, "schedule"],
          member,
          view: "schedule",
        }),
      );
    }
  }
  return out;
};

const healthRoutes = (): Array<Route.RouteLike> => [
  target(Route.get("health", "/health"), {
    _tag: "Health",
    keys: ["health"],
    view: "health",
  }),
  target(
    Route.get("nodeHealth", "/health/*nodeId").pipe(
      Route.params(Schema.Struct({ nodeId: Schema.String })),
    ),
    {
      _tag: "Health",
      keys: ["health"],
      view: "health",
    },
  ),
];

/** Sync list of destinations for a Group tree (tests / tooling). */
export const routesOf = (
  root: RouteGroup,
  options?: AsRoutesOptions,
): ReadonlyArray<Route.RouteLike> => {
  const health = options?.health !== false;
  return [
    ...(health ? healthRoutes() : []),
    ...membersToRoutes(root, []),
  ];
};

/**
 * Effect that yields Route destinations for a Group tree — **typed** for
 * `Route.group(…).fromEffect(…)` / UrlBuilder.
 *
 * ```ts
 * Route.group("hub", { topLevel: true }).fromEffect(Group.asRoutes(ServicesHub))
 * // urls.Nwsl.HttpApi(), urls.nodeHealth(nodeId), …
 * ```
 */
export function asRoutes<
  const Root extends {
    readonly key: string;
    readonly members: Record<string, unknown>;
  },
>(
  root: Root,
  options: AsRoutesOptions & { readonly health: false },
): AsRoutesEffect<MembersRouteLikes<Root["members"]>>;
export function asRoutes<
  const Root extends {
    readonly key: string;
    readonly members: Record<string, unknown>;
  },
>(
  root: Root,
  options?: AsRoutesOptions,
): AsRoutesEffect<HealthRouteLikes | MembersRouteLikes<Root["members"]>>;
export function asRoutes(
  root: RouteGroup,
  options?: AsRoutesOptions,
): AsRoutesEffect {
  const effect = Effect.sync(() => routesOf(root, options));
  return Object.assign(effect, {
    [AsRoutesTypeId]: { root },
  }) as AsRoutesEffect;
}

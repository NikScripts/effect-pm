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
import type { Group, GroupTop } from "./uiRoutes";
import type * as uiRoute from "./uiRoute";

export type { RouteGroup } from "./asRoutesBrand";
export type { AsRoutesEffect } from "./asRoutesBrand";
export { AsRoutesTypeId } from "./asRoutesBrand";

export type AsRoutesOptions = {
  /** Include `/health` + `/health/:nodeId` (default `true`). */
  readonly health?: boolean | undefined;
};

type Path = uiRoute.Path;

/** Leaf destinations generated for one Group member name. */
export type LeafRouteLikes<K extends string> =
  | uiRoute.Route<K, Path>
  | uiRoute.Route<`${K}Logs`, Path>
  | uiRoute.Route<`${K}Schedule`, Path>;

type NestedGroupRouteLike<
  Id extends string,
  M extends Record<string, unknown>,
  Depth extends ReadonlyArray<unknown>,
> = Group<
  Id,
  | uiRoute.Route<"index", Path>
  | Extract<MembersRouteLikes<M, Depth>, uiRoute.Constraint>,
  Extract<MembersRouteLikes<M, Depth>, GroupTop>,
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

/** `/health` + `/health/:nodeId` when `health` is not false. */
export type HealthRouteLikes =
  | uiRoute.Route<"health", Path>
  | uiRoute.Route<"healthNode", Path, { readonly nodeId: string }>;

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

const formatPath = (keys: ReadonlyArray<string>): Route.Path => {
  const href =
    keys.length === 0 ? "/" : `/${keys.map(encodeURIComponent).join("/")}`;
  return href as Route.Path;
};

const target = <Id extends string, PathType extends Route.Path, Params>(
  endpoint: Route.Endpoint<Id, PathType, Params>,
  value: {
    readonly keys: ReadonlyArray<string>;
    readonly member: unknown | null;
    readonly view?: string | undefined;
    readonly kind: "group" | "leaf" | "leafView" | "health";
  },
): Route.Endpoint<Id, PathType, Params> =>
  Route.annotate(endpoint, Route.Target, {
    keys: value.keys,
    member: value.member,
    view: value.view,
    kind: value.kind,
  });

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
            keys,
            member,
            kind: "group",
          }),
          ...membersToRoutes(member, keys),
        ),
      );
    } else {
      out.push(
        target(Route.get(name, path), {
          keys,
          member,
          kind: "leaf",
        }),
        target(Route.get(`${name}Logs`, formatPath([...keys, "logs"])), {
          keys: [...keys, "logs"],
          member,
          view: "logs",
          kind: "leafView",
        }),
        target(Route.get(`${name}Schedule`, formatPath([...keys, "schedule"])), {
          keys: [...keys, "schedule"],
          member,
          view: "schedule",
          kind: "leafView",
        }),
      );
    }
  }
  return out;
};

const healthRoutes = (): Array<Route.RouteLike> => [
  target(Route.get("health", "/health"), {
    keys: ["health"],
    member: null,
    view: "health",
    kind: "health",
  }),
  target(
    Route.get("healthNode", "/health/:nodeId").pipe(
      Route.params(Schema.Struct({ nodeId: Schema.String })),
    ),
    {
      keys: ["health"],
      member: null,
      view: "health",
      kind: "health",
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
 * // urls.Nwsl.HttpApi(), urls.healthNode({ params: { nodeId } }), …
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

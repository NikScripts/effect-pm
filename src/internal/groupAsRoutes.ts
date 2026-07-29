/**
 * Build {@link ../ui/Route} destinations from a Group tree — used by
 * {@link ../Group.asRoutes}. Route/Router stay Group-agnostic; Group owns this bridge.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Route from "../ui/Route";
import {
  AsRoutesTypeId,
  type RouteGroup,
} from "./asRoutesBrand";

export type { RouteGroup } from "./asRoutesBrand";
export { AsRoutesTypeId } from "./asRoutesBrand";

export type AsRoutesOptions = {
  /** Include `/health` + `/health/:nodeId` (default `true`). */
  readonly health?: boolean | undefined;
};

/** Effect of {@link Route.RouteLike}s, branded with the source Group for `fromEffect`. */
export type AsRoutesEffect = Effect.Effect<
  ReadonlyArray<Route.RouteLike>,
  never,
  never
> & {
  readonly [AsRoutesTypeId]: { readonly root: RouteGroup };
};

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
 * Effect that yields Route destinations for a Group tree.
 * Pass to {@link Route.Group.fromEffect}:
 *
 * ```ts
 * Route.group("hub", { topLevel: true }).fromEffect(Group.asRoutes(ServicesHub))
 * ```
 */
export const asRoutes = (
  root: RouteGroup,
  options?: AsRoutesOptions,
): AsRoutesEffect => {
  const effect = Effect.sync(() => routesOf(root, options));
  return Object.assign(effect, {
    [AsRoutesTypeId]: { root },
  });
};

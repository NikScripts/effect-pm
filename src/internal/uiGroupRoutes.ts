/**
 * Build a {@link ../ui/Route} catalog from a Group tree using the same
 * `Route.make` / `group` / `get` constructors apps use — ordinary loops, no
 * Group-Tag declaration helper on the public routing API.
 *
 * Each destination is annotated with {@link Route.Target} so {@link ../ui/Router}
 * can read `selected` / `view` from match.
 */
import { Schema } from "effect";
import * as Group from "../Group";
import * as Route from "../ui/Route";
import {
  formatGroupPath,
  type RouteGroup,
} from "../ui/GroupRoute";
import type { ApiConstraint } from "./uiRoutes";

const isGroupNode = (x: unknown): x is RouteGroup => Group.isGroup(x);

const pathOf = (keys: ReadonlyArray<string>): Route.Path => {
  const href = formatGroupPath(keys);
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

/** Nested Route.group / Route.get tree mirroring Group membership. */
const membersToRoutes = (
  node: RouteGroup,
  prefix: ReadonlyArray<string>,
): Array<Route.RouteLike> => {
  const out: Array<Route.RouteLike> = [];
  for (const [name, member] of Object.entries(Group.members(node))) {
    const keys = [...prefix, name];
    const path = pathOf(keys);
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
        target(Route.get(`${name}Logs`, pathOf([...keys, "logs"])), {
          keys: [...keys, "logs"],
          member,
          view: "logs",
          kind: "leafView",
        }),
        target(Route.get(`${name}Schedule`, pathOf([...keys, "schedule"])), {
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

const rootId = (root: RouteGroup): string => {
  const key = root.key;
  const slash = key.lastIndexOf("/");
  const leaf = slash === -1 ? key : key.slice(slash + 1);
  return leaf.length > 0 ? leaf : "dashboard";
};

/**
 * Catalog for a Group dashboard: member short-name paths + `/health` shell pages.
 */
export const routesForGroup = (root: RouteGroup): ApiConstraint =>
  Route.make(rootId(root)).add(
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
    ...membersToRoutes(root, []),
  );

/**
 * Build a {@link ../ui/Route} catalog from a Group tree using the same
 * `Route.make` / `group` / `get` constructors apps use — ordinary loops, no
 * Group-Tag declaration helper on the public routing API.
 */
import { Schema } from "effect";
import * as Group from "../Group";
import * as Route from "../ui/Route";
import {
  formatGroupPath,
  type RouteGroup,
} from "../ui/GroupRoute";

const isGroupNode = (x: unknown): x is RouteGroup => Group.isGroup(x);

const pathOf = (keys: ReadonlyArray<string>): Route.Path => {
  const href = formatGroupPath(keys);
  return (href === "/" ? "/" : href) as Route.Path;
};

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
          Route.get("index", path),
          ...membersToRoutes(member, keys),
        ),
      );
    } else {
      out.push(
        Route.get(name, path),
        Route.get(`${name}Logs`, pathOf([...keys, "logs"])),
        Route.get(`${name}Schedule`, pathOf([...keys, "schedule"])),
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
export const routesForGroup = (root: RouteGroup): Route.Api =>
  Route.make(rootId(root)).add(
    Route.get("health", "/health"),
    Route.get("healthNode", "/health/:nodeId").pipe(
      Route.params(Schema.Struct({ nodeId: Schema.String })),
    ),
    ...membersToRoutes(root, []),
  );

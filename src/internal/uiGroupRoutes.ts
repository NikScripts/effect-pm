/**
 * Group path walk for Group-backed dashboard routers (root from
 * {@link ../ui/Route.DashboardRoot} annotation — not a Router constructor arg).
 */
import * as Group from "../Group";
import type { RouteGroup } from "./asRoutesBrand";

export type { RouteGroup } from "./asRoutesBrand";

const isGroupNode = (x: unknown): x is RouteGroup => Group.isGroup(x);

/** Format resolved keys as a URL pathname. */
export const formatGroupPath = (keys: ReadonlyArray<string>): string =>
  keys.length === 0 ? "/" : `/${keys.map(encodeURIComponent).join("/")}`;

/**
 * Walk `root` by `segments` (case-insensitive). Trailing segment after a leaf is
 * a sub-view; root `"health"` is the node-status shell page.
 */
export const resolveGroupRoute = (
  root: RouteGroup,
  segments: ReadonlyArray<string>,
): {
  readonly trail: ReadonlyArray<RouteGroup>;
  readonly selected: unknown | null;
  readonly view: string | undefined;
  readonly keys: ReadonlyArray<string>;
} => {
  const trail: Array<RouteGroup> = [root];
  const keys: Array<string> = [];
  let node: RouteGroup = root;
  let selected: unknown | null = null;
  let view: string | undefined = undefined;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment === undefined) break;
    const members = Group.members(node);
    const key = Object.keys(members).find(
      (k) => k.toLowerCase() === segment.toLowerCase(),
    );
    if (key === undefined) {
      if (
        keys.length === 0 &&
        trail.length === 1 &&
        segment.toLowerCase() === "health"
      ) {
        keys.push("health");
        view = "health";
        const nodeId = segments[i + 1];
        if (nodeId !== undefined) keys.push(nodeId);
      }
      break;
    }
    keys.push(key);
    const member = members[key];
    if (isGroupNode(member)) {
      node = member;
      trail.push(member);
    } else {
      selected = member;
      const next = segments[i + 1];
      if (next !== undefined) {
        view = next;
        keys.push(next);
      }
      break;
    }
  }
  return { trail, selected, view, keys };
};

const memberKeyOf = (member: unknown): string | undefined =>
  (typeof member === "object" || typeof member === "function") &&
  member !== null &&
  "key" in member &&
  typeof (member as { readonly key: unknown }).key === "string"
    ? (member as { readonly key: string }).key
    : undefined;

/** Short-name path from `root` to `target` (Group or leaf). */
export const pathToMember = (
  root: RouteGroup,
  target: unknown,
): ReadonlyArray<string> | undefined => {
  const targetKey = memberKeyOf(target);
  if (targetKey === undefined) return undefined;
  if (isGroupNode(root) && root.key === targetKey) return [];
  const walk = (
    node: RouteGroup,
    path: ReadonlyArray<string>,
  ): ReadonlyArray<string> | undefined => {
    for (const [name, member] of Object.entries(Group.members(node))) {
      const next = [...path, name];
      if (memberKeyOf(member) === targetKey) return next;
      if (isGroupNode(member)) {
        const found = walk(member, next);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  };
  return walk(root, []);
};

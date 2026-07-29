/**
 * @module ui/GroupRoute
 *
 * Legacy Group **path resolve** for Navigator (`resolveGroupRoute` — short-name
 * segment arrays). Retires when Navigator mounts a {@link ./Route} catalog.
 *
 * Not a route-declaration toolkit — use {@link ./Route} (`make` / `group` /
 * `get` / `addHttpApi`) for that.
 */
import * as Group from "../Group";

/** Group-shaped node the resolver can walk. @public */
export type RouteGroup = {
  readonly key: string;
  readonly members: Record<string, unknown>;
};

/**
 * Nav state from a path into a Group tree.
 *
 * @public
 */
export interface Resolved {
  readonly trail: ReadonlyArray<RouteGroup>;
  readonly keys: ReadonlyArray<string>;
  readonly group: RouteGroup;
  readonly selected: unknown | null;
  readonly view: string | undefined;
  readonly open: (key: string) => void;
  readonly back: () => void;
  readonly toRoot: () => void;
}

/**
 * @deprecated Use {@link Resolved}. Kept for `useGroupRoute` / existing imports.
 * @public
 */
export type GroupRoute = Resolved;

const isGroupNode = (x: unknown): x is RouteGroup => Group.isGroup(x);

/**
 * Walk `root` by `segments` (case-insensitive). Trailing segment after a leaf is
 * a sub-view; root `"health"` is the node-status shell page.
 *
 * @public
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

/** Format resolved keys as a URL pathname. @public */
export const formatGroupPath = (keys: ReadonlyArray<string>): string =>
  keys.length === 0 ? "/" : `/${keys.map(encodeURIComponent).join("/")}`;

/** Depth-first path to a leaf by wire `key`. @public */
export const pathToLeafKey = (
  root: RouteGroup,
  tagKey: string,
): ReadonlyArray<string> | undefined => {
  const walk = (
    node: RouteGroup,
    path: ReadonlyArray<string>,
  ): ReadonlyArray<string> | undefined => {
    for (const [name, member] of Object.entries(Group.members(node))) {
      if (isGroupNode(member)) {
        const found = walk(member, [...path, name]);
        if (found !== undefined) return found;
      } else if (
        (typeof member === "object" || typeof member === "function") &&
        member !== null &&
        "key" in member &&
        member.key === tagKey
      ) {
        return [...path, name];
      }
    }
    return undefined;
  };
  return walk(root, []);
};

const memberKeyOf = (member: unknown): string | undefined =>
  (typeof member === "object" || typeof member === "function") &&
  member !== null &&
  "key" in member &&
  typeof (member as { readonly key: unknown }).key === "string"
    ? (member as { readonly key: string }).key
    : undefined;

/** Short-name path from `root` to `target` (Group or leaf). @public */
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

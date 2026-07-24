/**
 * @module ui/groupRoute
 *
 * Pure Group-tree path resolution shared by the web and TUI dashboards. The path is the
 * chain of member keys from the root (`ServicesHub → Wnba → ImportSchedule` →
 * `["Wnba", "ImportSchedule"]`). Matching is **case-insensitive**; resolved keys keep the
 * tree's actual casing. A trailing segment after a leaf is a leaf sub-view (e.g. `"logs"`).
 *
 * Renderers bind this to History (web) or in-memory state (TUI); the resolve math stays here.
 *
 */
import * as Group from "../Group";

/** A group-shaped node the router can walk (`Group.Tag` or `{ key, members }`). */
export type RouteGroup = {
  readonly key: string;
  readonly members: Record<string, unknown>;
};

/** Nav state derived from a path into a Group tree. */
export interface GroupRoute {
  /** `[root, …descended groups]` — the breadcrumb. */
  readonly trail: ReadonlyArray<RouteGroup>;
  /** Resolved member keys (and optional trailing leaf sub-view). */
  readonly keys: ReadonlyArray<string>;
  /** The deepest group in the path — the grid to render. */
  readonly group: RouteGroup;
  /** The open leaf tag if the path ends on a leaf, else `null`. */
  readonly selected: unknown | null;
  /** Sub-view of the selected leaf (e.g. `"logs"`), else `undefined`. */
  readonly view: string | undefined;
  /** Descend into a member by key (or append a leaf sub-view). */
  readonly open: (key: string) => void;
  /** Up one segment. */
  readonly back: () => void;
  /** Back to the root grid. */
  readonly toRoot: () => void;
}

const isGroupNode = (x: unknown): x is RouteGroup => Group.isGroup(x);

/**
 * Walk `root` by `segments` (case-insensitive), collecting actual member keys, the group
 * trail, and a selected leaf if the path ends on one. Stops at the first unresolved segment.
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
    const key = Object.keys(members).find((k) => k.toLowerCase() === segment.toLowerCase());
    if (key === undefined) break;
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

/**
 * Format resolved keys as a URL pathname (`/` or `/Wnba/ImportSchedule`).
 *
 * @public
 */
export const formatGroupPath = (keys: ReadonlyArray<string>): string =>
  keys.length === 0 ? "/" : `/${keys.map(encodeURIComponent).join("/")}`;

/**
 * Depth-first path of member keys from `root` to the leaf whose `key` equals `tagKey`.
 *
 * @public
 */
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

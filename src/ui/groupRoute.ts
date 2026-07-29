/**
 * @module ui/groupRoute
 *
 * Bridge between Hyperlink {@link ../Group} trees and UI navigation:
 *
 * 1. **Legacy resolve** — walk short member-name segments (`resolveGroupRoute`) for the
 *    current Navigator (arrays at the edge; retiring when Navigator mounts {@link ./Route}).
 * 2. **`routes`** — reflect a Group into a {@link ./Route.Group} using the **same**
 *    `Route.make` / `Route.group` / `.add` builders apps use by hand (not a private walk).
 *
 * ```ts
 * import * as Route from "hyperlink-ts/ui/Route"
 * import { routes } from "hyperlink-ts/ui"
 *
 * Route.app("dashboard").add(
 *   routes(ServicesHub, { leafViews: ["logs", "schedule"] }),
 *   Route.group("shell", { topLevel: true }).add(Route.make("health", "/health")),
 * )
 * ```
 */
import * as Group from "../Group";
import type * as Route from "./Route";
import * as uiRoutes from "../internal/uiRoutes";

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
  /** Sub-view of the selected leaf (e.g. `"logs"`) or root shell page (`"health"`). */
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
    if (key === undefined) {
      // Root shell page: /health or /health/<nodeId> (node id may contain `/` when decoded).
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

const memberKeyOf = (member: unknown): string | undefined =>
  (typeof member === "object" || typeof member === "function") &&
  member !== null &&
  "key" in member &&
  typeof (member as { readonly key: unknown }).key === "string"
    ? (member as { readonly key: string }).key
    : undefined;

/**
 * Depth-first path of **short member names** from `root` to `target` (Group or leaf),
 * matched by wire `key`. Used by {@link ../Navigator} so `/Nwsl/HttpApi` stays name-based.
 *
 * @public
 */
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

// =============================================================================
// Group → Route.Group (dynamic generation)
// =============================================================================

/**
 * Annotation stamped by {@link routes} — the Group or leaf member at this route.
 *
 * @public
 */
export const Member: typeof uiRoutes.Member = uiRoutes.Member;

/**
 * Annotation for a leaf sub-view name (`logs` / `schedule`).
 *
 * @public
 */
export const LeafView: typeof uiRoutes.LeafView = uiRoutes.LeafView;

export type RoutesOptions = {
  /** Leaf sub-view segments (e.g. `"logs"`, `"schedule"`). */
  readonly leafViews?: ReadonlyArray<string> | undefined;
};

/**
 * Reflect a Hyperlink Group into a path-bearing {@link Route.Group} by calling the
 * public Route builders (`Route.group` / `Route.make` / `.add`) — not a privileged path.
 *
 * For each member name `Nwsl` → nest at `/Nwsl`; nested leaf `HttpApi` → `/Nwsl/HttpApi`;
 * optional `leafViews` → `/Nwsl/HttpApi/logs`, etc. Member tags are annotated via
 * {@link Member} / {@link LeafView} for {@link Route.match}.
 *
 * @public
 */
export const routes = (
  root: RouteGroup,
  options?: RoutesOptions,
): Route.Group => uiRoutes.fromGroup(root, options);

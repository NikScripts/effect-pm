/**
 * @module ui/GroupRoute
 *
 * Bridge: Hyperlink {@link ../Group} ↔ UI {@link ./Route}.
 *
 * **Dynamic tools (most dashboard routes):** {@link from} + {@link gets} — walk a
 * Group and emit `Route.group` / `Route.get` (same builders as hand-written routes).
 *
 * **Legacy path resolve (Navigator):** {@link resolveGroupRoute} — segment arrays;
 * retires when Navigator mounts a `Route` catalog.
 *
 * ```ts
 * import * as Route from "hyperlink-ts/ui/Route"
 * import * as GroupRoute from "hyperlink-ts/ui/GroupRoute"
 *
 * const Dashboard = Route.make("dashboard").add(
 *   GroupRoute.from(ServicesHub, {
 *     leaf: (g, ctx) => g.add(...GroupRoute.gets(ctx, "logs", "schedule")),
 *   }),
 *   Route.group("shell", { topLevel: true }).add(
 *     Route.get("health", "/health"),
 *     Route.get("node", "/health/:nodeId").pipe(
 *       Route.params(Schema.Struct({ nodeId: Schema.String })),
 *     ),
 *   ),
 * )
 * ```
 *
 * @see docs/handoffs/ui-routes-dream.md
 */
import * as Group from "../Group";
import * as Route from "./Route";
import * as catalog from "../internal/uiRoutes";
import type { Path } from "../internal/uiRoute";

// =============================================================================
// Legacy resolve (Navigator)
// =============================================================================

/** Group-shaped node the resolver can walk. @public */
export type RouteGroup = {
  readonly key: string;
  readonly members: Record<string, unknown>;
};

/** @public */
export type Source = RouteGroup;

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

// =============================================================================
// Dynamic Route generation (HttpApi builders only)
// =============================================================================

/** Annotation: Group or leaf member at this route. @public */
export const Member: typeof catalog.Member = catalog.Member;

/** Annotation: sub-page id under a leaf. @public */
export const LeafView: typeof catalog.LeafView = catalog.LeafView;

export type LeafContext = {
  readonly name: string;
  readonly path: Path;
  readonly member: unknown;
};

export type FromOptions = {
  /**
   * Customize each leaf nest. Default: path-bearing `Route.group` + {@link Member}.
   * Add pages with {@link Route.get} via {@link gets}.
   */
  readonly leaf?: (group: Route.Group, context: LeafContext) => Route.Group;
};

/**
 * Reflect a Hyperlink Group into nested `Route.group`s — **the** dynamic tool
 * for most dashboard routes. Only calls `Route.group` / `.add` / `.annotate`.
 *
 * @public
 */
export const from = (root: Source, options?: FromOptions): Route.Group => {
  const leafFn = options?.leaf ?? ((g: Route.Group) => g);

  const walk = (node: Source, prefix: string): Route.Group => {
    const atRoot = prefix === "";
    let g: Route.Group = catalog
      .group(atRoot ? rootIdentifier(root) : lastSegment(prefix), {
        path: atRoot ? undefined : (prefix as Path),
        topLevel: atRoot,
      })
      .annotate(Member, node);

    for (const [name, member] of Object.entries(Group.members(node))) {
      const path = `${prefix}/${name}` as Path;
      if (Group.isGroup(member)) {
        g = g.add(walk(member, path));
      } else {
        const base = Route.group(name, { path }).annotate(Member, member);
        g = g.add(leafFn(base, { name, path, member }));
      }
    }
    return g;
  };

  return walk(root, "");
};

/**
 * Emit `Route.get` destinations under a leaf path (compose with {@link from}'s
 * `leaf` callback — not a `leafViews: string[]` bag).
 *
 * @public
 */
export const gets = (
  context: { readonly path: Path; readonly member: unknown },
  ...ids: ReadonlyArray<string>
): ReadonlyArray<Route.Constraint> =>
  ids.map((id) =>
    Route.get(id, `${context.path}/${id}` as Path)
      .annotate(Member, context.member)
      .annotate(LeafView, id),
  );

const rootIdentifier = (root: Source): string => {
  const key = root.key;
  const slash = key.lastIndexOf("/");
  return slash === -1 ? key : key.slice(slash + 1);
};

const lastSegment = (path: string): string => {
  const parts = path.split("/").filter((s) => s.length > 0);
  return parts[parts.length - 1] ?? path;
};

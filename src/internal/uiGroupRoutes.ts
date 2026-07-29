/**
 * Group dashboard routing plumbing for {@link ../ui/Router}:
 * path walk + catalog build (`Route.make` / `group` / `get` loops).
 *
 * Not a public module — apps use `Router.memory` / `history` / `makeGroup`.
 */
import { Schema } from "effect";
import * as Group from "../Group";
import * as Route from "../ui/Route";
import type { ApiConstraint } from "./uiRoutes";

/** Group-shaped node the resolver / catalog builder can walk. */
export type RouteGroup = {
  readonly key: string;
  readonly members: Record<string, unknown>;
};

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

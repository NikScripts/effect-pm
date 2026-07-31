/**
 * Group-tree navigation over a live {@link ../ui/Router} — used by dashboard
 * shells. Not part of core Router; pass the Group root explicitly.
 */
import { Context, Option } from "effect";
import * as Group from "../Group";
import * as Route from "../ui/Route";
import type * as Router from "../ui/Router";
import type { LeafTag } from "../ui/widgetRegistry";
import type { RouteGroup } from "./asRoutesBrand";
import {
  formatGroupPath,
  pathToMember,
  resolveGroupRoute,
} from "./uiGroupRoutes";

export type { RouteGroup };

export type MemberTag =
  | LeafTag
  | { readonly key: string; readonly members: Record<string, unknown> };

export type State = {
  readonly keys: ReadonlyArray<string>;
  readonly trail: ReadonlyArray<RouteGroup>;
  readonly selected: unknown | null;
  readonly view: string | undefined;
  readonly group: RouteGroup;
  readonly canUp: boolean;
  readonly match: Route.Match | undefined;
};

const normalize = (pathname: string): string => {
  if (pathname === "" || pathname === "/") return "/";
  const trimmed =
    pathname.endsWith("/") && pathname.length > 1
      ? pathname.slice(0, -1)
      : pathname;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
};

const segmentsOf = (pathname: string): ReadonlyArray<string> =>
  normalize(pathname)
    .split("/")
    .filter((s) => s.length > 0)
    .map(decodeURIComponent);

const trailFromKeys = (
  root: RouteGroup,
  keys: ReadonlyArray<string>,
): {
  readonly trail: ReadonlyArray<RouteGroup>;
  readonly group: RouteGroup;
} => {
  const walked = resolveGroupRoute(root, keys);
  return {
    trail: walked.trail,
    group: walked.trail[walked.trail.length - 1] ?? root,
  };
};

/** Resolve Group UI state from the current router location + root Group. */
export const state = (
  root: RouteGroup,
  router: Router.Service,
): State => {
  const match = router.match;
  if (match !== undefined) {
    const target = Option.getOrUndefined(
      Context.getOption(match.annotations, Route.Target),
    );
    if (target !== undefined) {
      const keys =
        target.kind === "Health" && match.params.nodeId !== undefined
          ? (["health", match.params.nodeId] as const)
          : target.keys;
      const { trail, group } =
        target.kind === "Health"
          ? { trail: [root] as const, group: root }
          : trailFromKeys(
              root,
              keys.filter((k) => k !== "logs" && k !== "schedule"),
            );
      return {
        keys,
        trail,
        selected:
          target.kind === "Leaf" || target.kind === "LeafView"
            ? target.member
            : null,
        view: target.view,
        group,
        canUp: keys.length > 0,
        match,
      };
    }
  }

  const walked = resolveGroupRoute(root, segmentsOf(router.pathname));
  return {
    keys: walked.keys,
    trail: walked.trail,
    selected: walked.selected,
    view: walked.view,
    group: walked.trail[walked.trail.length - 1] ?? root,
    canUp: walked.keys.length > 0,
    match,
  };
};

const setKeys = (
  root: RouteGroup,
  router: Router.Service,
  next: ReadonlyArray<string>,
  replace?: boolean,
): void => {
  const keys = resolveGroupRoute(root, next).keys;
  router.go(formatGroupPath(keys), replace === true ? { replace: true } : undefined);
};

export const open = (
  root: RouteGroup,
  router: Router.Service,
  member: MemberTag,
): void => {
  const path = pathToMember(root, member);
  if (path !== undefined) setKeys(root, router, path);
};

export const openKey = (
  root: RouteGroup,
  router: Router.Service,
  key: string,
): void => {
  const current = state(root, router);
  setKeys(root, router, [...current.keys, key]);
};

export const up = (root: RouteGroup, router: Router.Service): void => {
  const keys = state(root, router).keys;
  if (keys.length === 0) return;
  setKeys(root, router, keys.slice(0, -1), true);
};

export const openLogs = (
  root: RouteGroup,
  router: Router.Service,
  tag: LeafTag,
): void => {
  const path = pathToMember(root, tag);
  if (path !== undefined) setKeys(root, router, [...path, "logs"]);
};

export const openSchedule = (
  root: RouteGroup,
  router: Router.Service,
  tag: LeafTag,
): void => {
  const path = pathToMember(root, tag);
  if (path !== undefined) setKeys(root, router, [...path, "schedule"]);
};

/** `urls.health()` when present, else `/health`. */
export const openHealth = (router: Router.Service): void => {
  const health = (router.urls as Record<string, unknown>)["health"];
  if (typeof health === "function") {
    router.go((health as () => string)());
    return;
  }
  router.go("/health");
};

/** `urls.nodeHealth(id)` when present, else `/health/<id>`. */
export const openNode = (router: Router.Service, nodeId: string): void => {
  const nodeHealth = (router.urls as Record<string, unknown>)["nodeHealth"];
  if (typeof nodeHealth === "function") {
    router.go((nodeHealth as (id: string) => string)(nodeId));
    return;
  }
  router.go(formatGroupPath(["health", nodeId]));
};

export const toHref = formatGroupPath;
export const isGroupMember = Group.isGroup;

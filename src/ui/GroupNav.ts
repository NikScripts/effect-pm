/**
 * @module ui/GroupNav
 *
 * Group-tree navigation helpers over a live {@link ./Router}. Pass the Group
 * root explicitly — this is **not** part of core Router (catalog match / `go` /
 * `to` / `Link` / `Outlet`).
 *
 * ```tsx
 * const nav = GroupNav.use(ServicesHub)
 * nav.open(HttpApi)
 * nav.up()
 * router.to((u) => u.health()) // or GroupNav.openHealth(router)
 * ```
 */
import * as internal from "../internal/groupNav";
import type { LeafTag } from "./widgetRegistry";
import * as Router from "./Router";

export type MemberTag = internal.MemberTag;
export type RouteGroup = internal.RouteGroup;
export type State = internal.State;

export const state: typeof internal.state = internal.state;
export const open: typeof internal.open = internal.open;
export const openKey: typeof internal.openKey = internal.openKey;
export const up: typeof internal.up = internal.up;
export const openLogs: typeof internal.openLogs = internal.openLogs;
export const openSchedule: typeof internal.openSchedule = internal.openSchedule;
export const openHealth: typeof internal.openHealth = internal.openHealth;
export const openNode: typeof internal.openNode = internal.openNode;
export const toHref: typeof internal.toHref = internal.toHref;
export const isGroupMember: typeof internal.isGroupMember =
  internal.isGroupMember;

export type Live = State & {
  readonly router: Router.Service;
  readonly open: (member: MemberTag) => void;
  readonly openKey: (key: string) => void;
  readonly up: () => void;
  readonly openLogs: (tag: LeafTag) => void;
  readonly openSchedule: (tag: LeafTag) => void;
  readonly openHealth: () => void;
  readonly openNode: (nodeId: string) => void;
};

/**
 * Group navigation bound to the current {@link Router} + a root Group.
 * Re-renders on path changes.
 *
 * @public
 */
export const use = (root: RouteGroup): Live => {
  const router = Router.useRouter();
  const current = internal.state(root, router);
  return {
    ...current,
    router,
    open: (member) => internal.open(root, router, member),
    openKey: (key) => internal.openKey(root, router, key),
    up: () => internal.up(root, router),
    openLogs: (tag) => internal.openLogs(root, router, tag),
    openSchedule: (tag) => internal.openSchedule(root, router, tag),
    openHealth: () => internal.openHealth(router),
    openNode: (nodeId) => internal.openNode(router, nodeId),
  };
};

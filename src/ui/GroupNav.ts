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

/** Group or leaf member accepted by {@link open}. @public */
export type MemberTag = internal.MemberTag;

/** Root Group shape GroupNav walks. @public */
export type RouteGroup = internal.RouteGroup;

/** Snapshot of keys / trail / selection for the current location. @public */
export type State = internal.State;

/** Resolve {@link State} from a root Group + live Router. @public */
export const state: typeof internal.state = internal.state;

/** Push-navigate to a Group or leaf member. @public */
export const open: typeof internal.open = internal.open;

/** Push-navigate by a short-name path key under the current group. @public */
export const openKey: typeof internal.openKey = internal.openKey;

/** Replace-navigate one segment up. @public */
export const up: typeof internal.up = internal.up;

/** Open the logs view for a leaf under the root. @public */
export const openLogs: typeof internal.openLogs = internal.openLogs;

/** Open the schedule view for a leaf under the root. @public */
export const openSchedule: typeof internal.openSchedule = internal.openSchedule;

/** Navigate to the catalog health index (`urls.health()` or `/health`). @public */
export const openHealth: typeof internal.openHealth = internal.openHealth;

/** Navigate to a node health URL (`urls.nodeHealth(id)` or `/health/<id>`). @public */
export const openNode: typeof internal.openNode = internal.openNode;

/** Format short-name keys as an href (`["Nwsl","HttpApi"]` → `/Nwsl/HttpApi`). @public */
export const toHref: typeof internal.toHref = internal.toHref;

/** `Group.isGroup` re-export for member discrimination. @public */
export const isGroupMember: typeof internal.isGroupMember =
  internal.isGroupMember;

/** {@link State} plus bound actions for the current Router. @public */
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

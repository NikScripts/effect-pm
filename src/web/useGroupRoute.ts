/**
 * @module web/useGroupRoute
 *
 * URL routing that **mirrors the `Group` tree**: the path is the chain of member keys from
 * the root, so `ServicesHub → Wnba → ImportSchedule` is `/Wnba/ImportSchedule`. Matching is
 * **case-insensitive** (`/wnba/importschedule` resolves the same), while the URL keeps the
 * tree's actual key casing. Backed by the History API — deep links and back/forward work.
 *
 * ```tsx
 * const route = useGroupRoute(ServicesHub);
 * route.group;       // the group whose grid to render (deepest in the path)
 * route.selected;    // the open leaf tag, if the path ends on one (else null)
 * route.open("Wnba") // descend into a member by its key
 * route.back();      // up one segment
 * ```
 *
 * Renderer-agnostic (no per-app nav state) — wire the dashboards' grid/detail off
 * `route.group` / `route.selected`, and their open/back handlers to `route.open` / `back`.
 *
 * @since 1.0.0
 */
import * as React from "react";
import { Group } from "../Group";
import type { GroupNode } from "./GroupView";

/** Nav state derived from the URL. @since 1.0.0 */
export interface GroupRoute {
  /** `[root, …descended groups]` — the breadcrumb. */
  readonly trail: ReadonlyArray<GroupNode>;
  /** The deepest group in the path — the grid to render. */
  readonly group: GroupNode;
  /** The open leaf tag if the path ends on a leaf, else `null`. */
  readonly selected: unknown | null;
  /** Descend into a member by its key (a subgroup → drill in; a leaf → open its detail). */
  readonly open: (key: string) => void;
  /** Up one segment. */
  readonly back: () => void;
  /** Back to the root grid. */
  readonly toRoot: () => void;
}

const isGroupNode = (x: unknown): x is GroupNode => Group.isGroup(x);

const pathSegments = (): ReadonlyArray<string> =>
  (typeof window === "undefined" ? "" : window.location.pathname)
    .split("/")
    .filter((s) => s.length > 0)
    .map(decodeURIComponent);

/** Walk `root` by `segments` (case-insensitive), collecting the actual member keys, the group
 *  trail, and a selected leaf if the path ends on one. Stops at the first unresolved segment. */
const resolve = (
  root: GroupNode,
  segments: ReadonlyArray<string>,
): { readonly trail: ReadonlyArray<GroupNode>; readonly selected: unknown | null; readonly keys: ReadonlyArray<string> } => {
  const trail: Array<GroupNode> = [root];
  const keys: Array<string> = [];
  let node: GroupNode = root;
  let selected: unknown | null = null;
  for (const segment of segments) {
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
      break; // a leaf ends the path
    }
  }
  return { trail, selected, keys };
};

const toPath = (keys: ReadonlyArray<string>): string =>
  keys.length === 0 ? "/" : `/${keys.map(encodeURIComponent).join("/")}`;

/**
 * Two-way bind the browser URL to a position in a `Group` tree. Returns the resolved nav
 * state plus `open` / `back` / `toRoot` actions that push history entries.
 *
 * @since 1.0.0
 */
export const useGroupRoute = (root: GroupNode): GroupRoute => {
  const [keys, setKeys] = React.useState<ReadonlyArray<string>>(() => resolve(root, pathSegments()).keys);

  React.useEffect(() => {
    const onPop = (): void => setKeys(resolve(root, pathSegments()).keys);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [root]);

  const navigate = React.useCallback((next: ReadonlyArray<string>): void => {
    if (typeof window !== "undefined") window.history.pushState(null, "", toPath(next));
    setKeys(next);
  }, []);

  const { trail, selected } = React.useMemo(() => resolve(root, keys), [root, keys]);

  return {
    trail,
    group: trail[trail.length - 1] ?? root,
    selected,
    open: React.useCallback((key: string) => navigate([...keys, key]), [navigate, keys]),
    back: React.useCallback(() => navigate(keys.slice(0, -1)), [navigate, keys]),
    toRoot: React.useCallback(() => navigate([]), [navigate]),
  };
};

/**
 * @module ui/Navigator
 *
 * Parent-owned navigation for View skins — short **member names** as the path
 * (`/Nwsl/HttpApi`), not wire keys. Steal: {@link ./GroupRoute} resolve math +
 * Effect `Context.Service` / Layer (same seam as View skins).
 *
 * ```ts
 * import * as Navigator from "hyperlink-ts/ui/Navigator"
 * import * as View from "hyperlink-ts/ui/View"
 *
 * const ui = View.compose({
 *   views: WebDashboardViews.layer,
 *   navigator: Navigator.history(ServicesHub),
 * })
 * ```
 *
 * @see docs/handoffs/view-compose-lock.md
 */
import * as React from "react";
import { Context, Layer } from "effect";
import * as Group from "../Group";
import {
  formatGroupPath,
  pathToMember,
  resolveGroupRoute,
  type RouteGroup,
} from "./GroupRoute";
import type { LeafTag } from "./widgetRegistry";

// =============================================================================
// Types
// =============================================================================

/** Group or leaf a Navigator can open — what {@link Group.isGroup} narrows against. @public */
export type MemberTag =
  | LeafTag
  | { readonly key: string; readonly members: Record<string, unknown> };

/** Live navigation API provided to View skins / shells. @public */
export interface Service {
  readonly root: RouteGroup;
  readonly mode: "memory" | "history";
  /** Short-name path — `["Nwsl", "HttpApi"]`. */
  readonly path: ReadonlyArray<string>;
  readonly trail: ReadonlyArray<RouteGroup>;
  /** Deepest group (grid to render). */
  readonly group: RouteGroup;
  readonly selected: unknown | null;
  /** Leaf sub-view (`"logs"` / `"schedule"`) or root shell page (`"health"`). */
  readonly view: string | undefined;
  readonly open: (member: MemberTag) => void;
  /** Descend by short member name from the current group (or append leaf sub-view). */
  readonly openKey: (key: string) => void;
  readonly back: () => void;
  readonly toRoot: () => void;
  /** Show the leaf’s `page`-sized content outlet as logs (path + `"logs"`). */
  readonly openLogs: (tag: LeafTag) => void;
  /** Show schedule as page content (path + `"schedule"`). */
  readonly openSchedule: (tag: LeafTag) => void;
  /** Root node-status board — path `["health"]` (`/health`). */
  readonly openHealth: () => void;
  /** Node detail under health — path `["health", nodeId]` (`/health/<nodeId>`). */
  readonly openNode: (nodeId: string) => void;
  readonly subscribe: (listener: () => void) => () => void;
  /** History mode: re-read `location.pathname`. @internal */
  readonly syncFromLocation: () => void;
}

/**
 * Navigator Context service — provide with {@link memory} / {@link history}.
 *
 * @public
 */
export class Navigator extends Context.Service<Navigator, Service>()(
  "hyperlink-ts/ui/Navigator",
) {}

// =============================================================================
// Path helpers
// =============================================================================

/** Format short-name path as a URL (`/` or `/Nwsl/HttpApi`). @public */
export const toHref = formatGroupPath;

const locationSegments = (): ReadonlyArray<string> =>
  (typeof window === "undefined" ? "" : window.location.pathname)
    .split("/")
    .filter((s) => s.length > 0)
    .map(decodeURIComponent);

// =============================================================================
// Construction
// =============================================================================

const makeService = (
  root: RouteGroup,
  mode: "memory" | "history",
): Service => {
  let keys: ReadonlyArray<string> =
    mode === "history" ? resolveGroupRoute(root, locationSegments()).keys : [];
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const l of listeners) l();
  };

  const resolved = () => resolveGroupRoute(root, keys);

  const setKeys = (next: ReadonlyArray<string>): void => {
    const resolvedKeys = resolveGroupRoute(root, next).keys;
    if (
      resolvedKeys.length === keys.length &&
      resolvedKeys.every((k, i) => k === keys[i])
    ) {
      return;
    }
    keys = resolvedKeys;
    if (mode === "history" && typeof window !== "undefined") {
      window.history.pushState(null, "", toHref(keys));
    }
    notify();
  };

  const openMember = (member: MemberTag): void => {
    const path = pathToMember(root, member);
    if (path !== undefined) setKeys(path);
  };

  return {
    root,
    mode,
    get path() {
      return resolved().keys;
    },
    get trail() {
      return resolved().trail;
    },
    get group() {
      const { trail } = resolved();
      return trail[trail.length - 1] ?? root;
    },
    get selected() {
      return resolved().selected;
    },
    get view() {
      return resolved().view;
    },
    open: openMember,
    openKey: (key: string) => setKeys([...keys, key]),
    back: () => setKeys(keys.slice(0, -1)),
    toRoot: () => setKeys([]),
    openLogs: (tag) => {
      const path = pathToMember(root, tag);
      if (path !== undefined) setKeys([...path, "logs"]);
    },
    openSchedule: (tag) => {
      const path = pathToMember(root, tag);
      if (path !== undefined) setKeys([...path, "schedule"]);
    },
    openHealth: () => setKeys(["health"]),
    openNode: (nodeId) => setKeys(["health", nodeId]),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    syncFromLocation: () => {
      if (mode !== "history") return;
      const next = resolveGroupRoute(root, locationSegments()).keys;
      if (
        next.length === keys.length &&
        next.every((k, i) => k === keys[i])
      ) {
        return;
      }
      keys = next;
      notify();
    },
  };
};

/**
 * In-memory navigator — tests, embed, TUI. Path is not bound to `window.history`.
 *
 * @public
 */
export const memory = (root: RouteGroup): Layer.Layer<Navigator> =>
  Layer.sync(Navigator, () => makeService(root, "memory"));

/**
 * Browser History navigator — batteries web shell. Short names ↔ `/Nwsl/HttpApi`.
 *
 * @public
 */
export const history = (root: RouteGroup): Layer.Layer<Navigator> =>
  Layer.sync(Navigator, () => makeService(root, "history"));

// =============================================================================
// React
// =============================================================================

const NavigatorReactContext = React.createContext<Service | null>(null);

/**
 * Provide a live {@link Service} to descendant skins (used by {@link ../View.compose}).
 *
 * @public
 */
export const Provider = (props: {
  readonly value: Service;
  readonly children: React.ReactNode;
}): React.ReactElement => {
  const { value } = props;
  React.useEffect(() => {
    if (value.mode !== "history" || typeof window === "undefined") return;
    value.syncFromLocation();
    const onPop = (): void => value.syncFromLocation();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [value]);
  return React.createElement(
    NavigatorReactContext.Provider,
    { value },
    props.children,
  );
};

/**
 * Read the parent {@link Navigator} service. Re-renders on path changes.
 *
 * @public
 */
export const useNavigator = (): Service => {
  const nav = React.useContext(NavigatorReactContext);
  if (nav === null) {
    throw new Error("Navigator: render inside View.compose(…).Provider (or Navigator.Provider)");
  }
  const [, bump] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => nav.subscribe(bump), [nav]);
  return nav;
};

/** True when a Navigator Provider is mounted. @public */
export const useHasNavigator = (): boolean =>
  React.useContext(NavigatorReactContext) !== null;

/** Optional navigator (skins that work with or without compose). @public */
export const useNavigatorOption = (): Service | null => {
  const nav = React.useContext(NavigatorReactContext);
  const [, bump] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    if (nav === null) return;
    return nav.subscribe(bump);
  }, [nav]);
  return nav;
};

/** Re-export guard for compose Grid. @public */
export const isGroupMember = Group.isGroup;

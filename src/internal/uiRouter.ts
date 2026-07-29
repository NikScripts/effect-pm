/**
 * Internal impl for {@link ../ui/Router}.
 */
import { Context, Option } from "effect";
import * as Group from "../Group";
import * as Route from "../ui/Route";
import {
  formatGroupPath,
  pathToMember,
  resolveGroupRoute,
  type RouteGroup,
} from "../ui/GroupRoute";
import type { LeafTag } from "../ui/widgetRegistry";

// =============================================================================
// Types
// =============================================================================

export type MemberTag =
  | LeafTag
  | { readonly key: string; readonly members: Record<string, unknown> };

export type HistoryAction = "push" | "replace";

/** Live navigation API — provide with memory / history layers. */
export interface Service {
  readonly api: Route.Api;
  readonly mode: "memory" | "history";
  readonly pathname: string;
  readonly match: Route.Match | undefined;
  readonly urls: Route.UrlBuilder;
  readonly go: (
    pathname: string,
    options?: { readonly replace?: boolean },
  ) => void;
  readonly to: (
    build: (urls: Route.UrlBuilder) => string,
    options?: { readonly replace?: boolean },
  ) => void;
  /** Pop one history / memory entry. */
  readonly back: () => void;
  /** Navigate to `/` (replace). */
  readonly toRoot: () => void;
  readonly subscribe: (listener: () => void) => () => void;
  /** @internal */
  readonly syncFromLocation: () => void;

  /**
   * Group root when layered from a Group; `undefined` for bare catalogs.
   * Group helpers throw without a root.
   */
  readonly root: RouteGroup | undefined;
  /** Short-name path segments — `["Nwsl", "HttpApi"]`. */
  readonly path: ReadonlyArray<string>;
  readonly trail: ReadonlyArray<RouteGroup>;
  /** Deepest group (grid to render), or root when at `/`. */
  readonly group: RouteGroup | undefined;
  readonly selected: unknown | null;
  /** Leaf sub-view (`"logs"` / `"schedule"`) or root shell page (`"health"`). */
  readonly view: string | undefined;
  /** True when {@link up} would change the path. */
  readonly canUp: boolean;
  readonly open: (member: MemberTag) => void;
  readonly openKey: (key: string) => void;
  /** Pop one short-name segment (replace — keeps history coherent). */
  readonly up: () => void;
  readonly openLogs: (tag: LeafTag) => void;
  readonly openSchedule: (tag: LeafTag) => void;
  readonly openHealth: () => void;
  readonly openNode: (nodeId: string) => void;
}

export const toHref = formatGroupPath;
export const isGroupMember = Group.isGroup;

// =============================================================================
// Path helpers
// =============================================================================

const normalize = (pathname: string): string => {
  if (pathname === "" || pathname === "/") return "/";
  const trimmed =
    pathname.endsWith("/") && pathname.length > 1
      ? pathname.slice(0, -1)
      : pathname;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
};

const locationPathname = (): string =>
  typeof window === "undefined" ? "/" : normalize(window.location.pathname);

const segmentsOf = (pathname: string): ReadonlyArray<string> =>
  normalize(pathname)
    .split("/")
    .filter((s) => s.length > 0)
    .map(decodeURIComponent);

const collapseStack = (stack: Array<string>): void => {
  while (
    stack.length > 1 &&
    stack[stack.length - 1] === stack[stack.length - 2]
  ) {
    stack.pop();
  }
};

const requireRoot = (
  root: RouteGroup | undefined,
  method: string,
): RouteGroup => {
  if (root === undefined) {
    throw new Error(
      `Router.${method} requires a Group-backed router (Router.memory(group) / Router.history(group))`,
    );
  }
  return root;
};

const urlMethod = (
  urls: Route.UrlBuilder,
  id: string,
):
  | ((request?: { readonly params?: Record<string, string> }) => string)
  | undefined => {
  const value = urls[id];
  return typeof value === "function" ? value : undefined;
};

// =============================================================================
// Resolve — match Target when present, else Group walk
// =============================================================================

const resolveState = (
  root: RouteGroup | undefined,
  api: Route.Api,
  pathname: string,
): {
  readonly keys: ReadonlyArray<string>;
  readonly trail: ReadonlyArray<RouteGroup>;
  readonly selected: unknown | null;
  readonly view: string | undefined;
  readonly group: RouteGroup | undefined;
  readonly match: Route.Match | undefined;
} => {
  const match = Option.getOrUndefined(Route.match(api, pathname));
  if (root === undefined) {
    return {
      keys: segmentsOf(pathname),
      trail: [],
      selected: null,
      view: undefined,
      group: undefined,
      match,
    };
  }

  const walked = resolveGroupRoute(root, segmentsOf(pathname));
  const group = walked.trail[walked.trail.length - 1] ?? root;

  if (match !== undefined) {
    const target = Option.getOrUndefined(
      Context.getOption(match.annotations, Route.Target),
    );
    if (target !== undefined) {
      const keys =
        target.kind === "health" && match.params.nodeId !== undefined
          ? (["health", match.params.nodeId] as const)
          : target.keys;
      return {
        keys,
        trail: walked.trail,
        selected:
          target.kind === "leaf" || target.kind === "leafView"
            ? target.member
            : null,
        view: target.view,
        group,
        match,
      };
    }
  }

  return {
    keys: walked.keys,
    trail: walked.trail,
    selected: walked.selected,
    view: walked.view,
    group,
    match,
  };
};

// =============================================================================
// Construction
// =============================================================================

export const makeService = (
  api: Route.Api,
  mode: "memory" | "history",
  root: RouteGroup | undefined,
): Service => {
  const urls = Route.urlBuilder(api);
  let pathname =
    mode === "history" ? locationPathname() : (normalize("/") as string);
  const stack: Array<string> = mode === "memory" ? [pathname] : [];
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const l of listeners) l();
  };

  const setPathname = (next: string, action: HistoryAction): void => {
    const normalized = normalize(next);
    if (normalized === pathname && action === "push") return;

    if (mode === "memory") {
      if (action === "push") {
        pathname = normalized;
        stack.push(pathname);
      } else {
        pathname = normalized;
        if (stack.length === 0) stack.push(pathname);
        else stack[stack.length - 1] = pathname;
        collapseStack(stack);
      }
    } else {
      pathname = normalized;
      if (typeof window !== "undefined") {
        if (action === "push") window.history.pushState(null, "", pathname);
        else window.history.replaceState(null, "", pathname);
      }
    }
    notify();
  };

  const state = () => resolveState(root, api, pathname);

  const setKeys = (
    next: ReadonlyArray<string>,
    action: HistoryAction,
  ): void => {
    if (root === undefined) {
      setPathname(toHref(next), action);
      return;
    }
    const keys = resolveGroupRoute(root, next).keys;
    setPathname(toHref(keys), action);
  };

  return {
    api,
    mode,
    urls,
    root,
    get pathname() {
      return pathname;
    },
    get match() {
      return state().match;
    },
    go: (next, options) =>
      setPathname(next, options?.replace === true ? "replace" : "push"),
    to: (build, options) =>
      setPathname(
        build(urls),
        options?.replace === true ? "replace" : "push",
      ),
    back: () => {
      if (mode === "history") {
        if (typeof window !== "undefined") window.history.back();
        return;
      }
      if (stack.length <= 1) return;
      stack.pop();
      pathname = stack[stack.length - 1] ?? "/";
      notify();
    },
    toRoot: () => setPathname("/", "replace"),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    syncFromLocation: () => {
      if (mode !== "history") return;
      const next = locationPathname();
      if (next === pathname) return;
      pathname = next;
      notify();
    },
    get path() {
      return state().keys;
    },
    get trail() {
      return state().trail;
    },
    get group() {
      return state().group;
    },
    get selected() {
      return state().selected;
    },
    get view() {
      return state().view;
    },
    get canUp() {
      return state().keys.length > 0;
    },
    open: (member) => {
      const r = requireRoot(root, "open");
      const path = pathToMember(r, member);
      if (path !== undefined) setKeys(path, "push");
    },
    openKey: (key) => {
      requireRoot(root, "openKey");
      setKeys([...state().keys, key], "push");
    },
    up: () => {
      requireRoot(root, "up");
      const keys = state().keys;
      if (keys.length === 0) return;
      setKeys(keys.slice(0, -1), "replace");
    },
    openLogs: (tag) => {
      const r = requireRoot(root, "openLogs");
      const path = pathToMember(r, tag);
      if (path !== undefined) setKeys([...path, "logs"], "push");
    },
    openSchedule: (tag) => {
      const r = requireRoot(root, "openSchedule");
      const path = pathToMember(r, tag);
      if (path !== undefined) setKeys([...path, "schedule"], "push");
    },
    openHealth: () => {
      requireRoot(root, "openHealth");
      const health = urlMethod(urls, "health");
      setPathname(health !== undefined ? health() : "/health", "push");
    },
    openNode: (nodeId) => {
      requireRoot(root, "openNode");
      const healthNode = urlMethod(urls, "healthNode");
      setPathname(
        healthNode !== undefined
          ? healthNode({ params: { nodeId } })
          : toHref(["health", nodeId]),
        "push",
      );
    },
  };
};

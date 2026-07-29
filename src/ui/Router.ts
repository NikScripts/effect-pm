/**
 * @module ui/Router
 *
 * Runtime navigation over a {@link ./Route} catalog — `Context.Service` with
 * swappable transport layers ({@link memory} / {@link history}).
 *
 * The catalog is data (`Route.make…`); this service owns location, match, and go.
 * Pass a Group to {@link memory} / {@link history} and the layer builds that
 * catalog with the same `Route.make` / `group` / `get` constructors (ordinary
 * loops) plus Group resolve helpers (`open` / `up` / `path` / …).
 *
 * ```ts
 * import * as Route from "hyperlink-ts/ui/Route"
 * import * as Router from "hyperlink-ts/ui/Router"
 *
 * const site = Route.make("site").add(
 *   Route.get("home", "/home"),
 *   Route.group("app").add(Route.get("dashboard", "/app")),
 * )
 *
 * const layer = Router.history(site) // or Router.memory(site)
 * // Group dashboard:
 * const dash = Router.history(ServicesHub)
 *
 * const router = yield* Router.Router
 * router.to((urls) => urls.app.dashboard())
 * ```
 *
 * @see docs/handoffs/ui-routes-dream.md
 */
import * as React from "react";
import { Context, Layer, Option } from "effect";
import * as Group from "../Group";
import { routesForGroup } from "../internal/uiGroupRoutes";
import * as Route from "./Route";
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

/** Group or leaf a Group-backed router can open. @public */
export type MemberTag =
  | LeafTag
  | { readonly key: string; readonly members: Record<string, unknown> };

/** Live navigation API — provide with {@link memory} / {@link history}. @public */
export interface Service {
  readonly api: Route.Api;
  readonly mode: "memory" | "history";
  /** Current pathname (`/home`, `/Nwsl/HttpApi`). */
  readonly pathname: string;
  /** Match against {@link api}, if any. */
  readonly match: Route.Match | undefined;
  /** URL builder for {@link api}. */
  readonly urls: Route.UrlBuilder;
  /** Set pathname (history mode also `pushState`). */
  readonly go: (pathname: string) => void;
  /** Navigate via {@link urls} — `to((u) => u.app.dashboard())`. */
  readonly to: (build: (urls: Route.UrlBuilder) => string) => void;
  /** Up one history/memory entry. */
  readonly back: () => void;
  /** Go to `/`. */
  readonly toRoot: () => void;
  readonly subscribe: (listener: () => void) => () => void;
  /** History mode: re-read `location.pathname`. @internal */
  readonly syncFromLocation: () => void;

  /**
   * Group root when layered from a Group; `undefined` for bare catalogs.
   * Resolve helpers below no-op / return empty without a root.
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
  readonly open: (member: MemberTag) => void;
  /** Descend by short member name from the current group (or append leaf sub-view). */
  readonly openKey: (key: string) => void;
  /** Pop one short-name segment (parent group / leave sub-view). */
  readonly up: () => void;
  /** Show the leaf’s page-sized logs content (path + `"logs"`). */
  readonly openLogs: (tag: LeafTag) => void;
  /** Show schedule as page content (path + `"schedule"`). */
  readonly openSchedule: (tag: LeafTag) => void;
  /** Root node-status board — `/health`. */
  readonly openHealth: () => void;
  /** Node detail under health — `/health/<nodeId>`. */
  readonly openNode: (nodeId: string) => void;
}

/**
 * Router Context service — provide with {@link memory} / {@link history}.
 *
 * @public
 */
export class Router extends Context.Service<Router, Service>()(
  "hyperlink-ts/ui/Router",
) {}

// =============================================================================
// Path helpers
// =============================================================================

/** Format short-name path as a URL (`/` or `/Nwsl/HttpApi`). @public */
export const toHref = formatGroupPath;

/** Re-export guard for compose Grid. @public */
export const isGroupMember = Group.isGroup;

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

// =============================================================================
// Construction
// =============================================================================

const makeService = (
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

  const setPathname = (next: string, pushHistory: boolean): void => {
    const normalized = normalize(next);
    if (normalized === pathname) return;
    pathname = normalized;
    if (mode === "memory") {
      stack.push(pathname);
    } else if (pushHistory && typeof window !== "undefined") {
      window.history.pushState(null, "", pathname);
    }
    notify();
  };

  const resolved = () => {
    if (root === undefined) {
      const keys = segmentsOf(pathname);
      return {
        keys,
        trail: [] as ReadonlyArray<RouteGroup>,
        selected: null as unknown | null,
        view: undefined as string | undefined,
        group: undefined as RouteGroup | undefined,
      };
    }
    const r = resolveGroupRoute(root, segmentsOf(pathname));
    return {
      keys: r.keys,
      trail: r.trail,
      selected: r.selected,
      view: r.view,
      group: r.trail[r.trail.length - 1] ?? root,
    };
  };

  const setKeys = (next: ReadonlyArray<string>): void => {
    if (root === undefined) {
      setPathname(toHref(next), true);
      return;
    }
    const keys = resolveGroupRoute(root, next).keys;
    setPathname(toHref(keys), true);
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
      return Option.getOrUndefined(Route.match(api, pathname));
    },
    go: (next) => setPathname(next, true),
    to: (build) => setPathname(build(urls), true),
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
    toRoot: () => setPathname("/", true),
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
      return resolved().keys;
    },
    get trail() {
      return resolved().trail;
    },
    get group() {
      return resolved().group;
    },
    get selected() {
      return resolved().selected;
    },
    get view() {
      return resolved().view;
    },
    open: (member) => {
      if (root === undefined) return;
      const path = pathToMember(root, member);
      if (path !== undefined) setKeys(path);
    },
    openKey: (key) => setKeys([...resolved().keys, key]),
    up: () => setKeys(resolved().keys.slice(0, -1)),
    openLogs: (tag) => {
      if (root === undefined) return;
      const path = pathToMember(root, tag);
      if (path !== undefined) setKeys([...path, "logs"]);
    },
    openSchedule: (tag) => {
      if (root === undefined) return;
      const path = pathToMember(root, tag);
      if (path !== undefined) setKeys([...path, "schedule"]);
    },
    openHealth: () => setKeys(["health"]),
    openNode: (nodeId) => setKeys(["health", nodeId]),
  };
};

const layerFor = (
  input: Route.Api | RouteGroup,
  mode: "memory" | "history",
): Layer.Layer<Router> => {
  if (Route.isApi(input)) {
    return Layer.sync(Router, () => makeService(input, mode, undefined));
  }
  const api = routesForGroup(input);
  return Layer.sync(Router, () => makeService(api, mode, input));
};

/**
 * In-memory router — tests, embed, TUI. Path is not bound to `window.history`.
 * Pass a {@link Route.Api} or a Group (catalog built with `Route.make` / `group` / `get`).
 *
 * @public
 */
export const memory = (input: Route.Api | RouteGroup): Layer.Layer<Router> =>
  layerFor(input, "memory");

/**
 * Browser History router — `pushState` / `popstate` against the catalog.
 * Pass a {@link Route.Api} or a Group (catalog built with `Route.make` / `group` / `get`).
 *
 * @public
 */
export const history = (input: Route.Api | RouteGroup): Layer.Layer<Router> =>
  layerFor(input, "history");

// =============================================================================
// React
// =============================================================================

const RouterReactContext = React.createContext<Service | null>(null);

/**
 * Provide a live {@link Service} to descendant skins.
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
    RouterReactContext.Provider,
    { value },
    props.children,
  );
};

/**
 * Read the parent {@link Router} service. Re-renders on path changes.
 *
 * @public
 */
export const useRouter = (): Service => {
  const router = React.useContext(RouterReactContext);
  if (router === null) {
    throw new Error(
      "Router: render inside View.compose(…).Provider (or Router.Provider)",
    );
  }
  const [, bump] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => router.subscribe(bump), [router]);
  return router;
};

/** True when a Router Provider is mounted. @public */
export const useHasRouter = (): boolean =>
  React.useContext(RouterReactContext) !== null;

/** Optional router (skins that work with or without compose). @public */
export const useRouterOption = (): Service | null => {
  const router = React.useContext(RouterReactContext);
  const [, bump] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    if (router === null) return;
    return router.subscribe(bump);
  }, [router]);
  return router;
};

/**
 * @module ui/Router
 *
 * Runtime navigation over a {@link ./Route} catalog — `Context.Service` with
 * swappable transport layers ({@link memory} / {@link history}).
 *
 * The catalog is data (`Route.make…`); this service owns location, match, and go.
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
 *
 * // in a fiber / ManagedRuntime:
 * const router = yield* Router.Router
 * router.to((urls) => urls.app.dashboard())
 * ```
 *
 * @see docs/handoffs/ui-routes-dream.md
 */
import * as React from "react";
import { Context, Layer, Option } from "effect";
import * as Route from "./Route";

// =============================================================================
// Service
// =============================================================================

/** Live navigation API — provide with {@link memory} / {@link history}. @public */
export interface Service {
  readonly api: Route.Api;
  readonly mode: "memory" | "history";
  /** Current pathname (`/home`, `/app`). */
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
// Construction
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

const makeService = (api: Route.Api, mode: "memory" | "history"): Service => {
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

  return {
    api,
    mode,
    urls,
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
  };
};

/**
 * In-memory router — tests, embed, TUI. Path is not bound to `window.history`.
 *
 * @public
 */
export const memory = (api: Route.Api): Layer.Layer<Router> =>
  Layer.sync(Router, () => makeService(api, "memory"));

/**
 * Browser History router — `pushState` / `popstate` against {@link api}.
 *
 * @public
 */
export const history = (api: Route.Api): Layer.Layer<Router> =>
  Layer.sync(Router, () => makeService(api, "history"));

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
    throw new Error("Router: render inside Router.Provider");
  }
  const [, bump] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => router.subscribe(bump), [router]);
  return router;
};

/** True when a Router Provider is mounted. @public */
export const useHasRouter = (): boolean =>
  React.useContext(RouterReactContext) !== null;

/** Optional router (skins that work with or without it). @public */
export const useRouterOption = (): Service | null => {
  const router = React.useContext(RouterReactContext);
  const [, bump] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    if (router === null) return;
    return router.subscribe(bump);
  }, [router]);
  return router;
};

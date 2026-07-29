/**
 * @module ui/Router
 *
 * Runtime navigation over a {@link ./Route} catalog — `Context.Service` with
 * swappable transport layers ({@link memory} / {@link history}).
 *
 * The catalog is data (`Route.make…`); this service owns location, match, and go.
 * Router never takes a Group tag — build destinations with Route, including
 * `Route.group(…).fromEffect(Group.asRoutes(…))` when the tree comes from a Group.
 *
 * Prefer {@link make} when you want a **typed** surface (`to` / `urls` know the
 * catalog). Layers erase to the Context service for DI.
 *
 * ```ts
 * import * as Group from "hyperlink-ts/Group"
 * import * as Route from "hyperlink-ts/ui/Route"
 * import * as Router from "hyperlink-ts/ui/Router"
 *
 * const site = Route.make("site").add(
 *   Route.get("home", "/home"),
 *   Route.group("hub", { topLevel: true }).fromEffect(Group.asRoutes(ServicesHub)),
 * )
 *
 * const router = Router.make(site, "memory")
 * router.to((urls) => urls.home())
 *
 * const layer = Router.history(site) // or Router.memory(site)
 * ```
 *
 * @see docs/handoffs/ui-routes-dream.md
 */
import * as React from "react";
import { Context, Layer } from "effect";
import * as internal from "../internal/uiRouter";
import type { ApiConstraint } from "../internal/uiRoutes";
import * as Route from "./Route";

// =============================================================================
// Types
// =============================================================================

/** Group or leaf a dashboard router can open (when catalog carries DashboardRoot). @public */
export type MemberTag = internal.MemberTag;

/**
 * Live navigation API — provide with {@link memory} / {@link history}, or build
 * with {@link make} for a catalog-typed surface.
 *
 * @public
 */
export type Service<A extends ApiConstraint = ApiConstraint> =
  internal.Service<A>;

/** Typed service for a concrete catalog (`HttpApiClient.ForApi` analogue). @public */
export type ForApi<A extends ApiConstraint> = Service<A>;

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
export const toHref = internal.toHref;

/** Re-export guard for compose Grid. @public */
export const isGroupMember = internal.isGroupMember;

// =============================================================================
// Construction
// =============================================================================

/**
 * Build a live router value (typed when `api` is a concrete catalog).
 *
 * @public
 */
export const make = <A extends ApiConstraint>(
  api: A,
  mode: "memory" | "history",
): Service<A> => internal.makeService(api, mode);

/**
 * In-memory router — tests, embed, TUI. Path is not bound to `window.history`.
 * Pass a {@link Route.Api} only (use `Group.asRoutes` + `fromEffect` for Groups).
 *
 * @public
 */
export const memory = (api: ApiConstraint): Layer.Layer<Router> =>
  Layer.sync(Router, () => internal.makeService(api, "memory"));

/**
 * Browser History router — `pushState` / `popstate` / `replaceState` against the catalog.
 * Pass a {@link Route.Api} only (use `Group.asRoutes` + `fromEffect` for Groups).
 *
 * @public
 */
export const history = (api: ApiConstraint): Layer.Layer<Router> =>
  Layer.sync(Router, () => internal.makeService(api, "history"));

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

/**
 * Current catalog match. Re-renders on navigate.
 *
 * Distinct from `View.useMatch` (View-kind matcher props).
 *
 * @public
 */
export const useMatch = (): Route.Match | undefined => useRouter().match;

/**
 * Current {@link Route.Target} annotation when the match carries one.
 *
 * @public
 */
export const useTarget = (): Route.TargetValue | undefined =>
  Route.targetOf(useRouter().match);

/**
 * In-app link — `href` + click → {@link Service.go} (no full navigation).
 *
 * ```tsx
 * <Router.Link to="/home">Home</Router.Link>
 * <Router.Link to={(urls) => urls.app.dashboard()}>App</Router.Link>
 * ```
 *
 * @public
 */
export const Link = (props: {
  readonly to: string | ((urls: Route.UrlBuilderLoose) => string);
  readonly replace?: boolean;
  readonly children: React.ReactNode;
  readonly className?: string;
}): React.ReactElement => {
  const router = useRouter();
  const href =
    typeof props.to === "function"
      ? props.to(router.urls as Route.UrlBuilderLoose)
      : props.to;
  return React.createElement(
    "a",
    {
      href,
      className: props.className,
      onClick: (event: React.MouseEvent<HTMLAnchorElement>) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.altKey ||
          event.ctrlKey ||
          event.shiftKey
        ) {
          return;
        }
        event.preventDefault();
        router.go(href, { replace: props.replace });
      },
    },
    props.children,
  );
};

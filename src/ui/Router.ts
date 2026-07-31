/**
 * @module ui/Router
 *
 * **Real UI router** over a {@link ./Route} catalog — match the URL, render the
 * route’s {@link ./Route.handle}, navigate with {@link Link} / `go` / `to`.
 *
 * ```tsx
 * const site = Route.make("site").add(
 *   Route.get("home", "/home").pipe(Route.handle(() => <Home />)),
 *   Route.get("user", "/users/:id").pipe(
 *     Route.params(Schema.Struct({ id: Schema.String })),
 *     Route.handle(({ params }) => <User id={params.id} />),
 *   ),
 * )
 *
 * const router = Router.make(site, "History")
 *
 * <Router.Provider value={router}>
 *   <Router.Link to={(u) => u.home()}>Home</Router.Link>
 *   <Router.Link to={(u) => u.user("42", { query: { tab: "bio" } })}>
 *     User
 *   </Router.Link>
 *   <Router.Outlet />
 * </Router.Provider>
 * ```
 *
 * **One service.** This entry is the non-Waku layer (`make` / `memory` / `history`).
 * Waku layer: `hyperlink-ts/ui/Router/waku` (same `Service`, unified `Provider`).
 * Group drill-down: {@link ./GroupNav} (on top — not inside Router).
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
// Construction
// =============================================================================

/**
 * Build a live router value (typed when `api` is a concrete catalog).
 *
 * @public
 */
export const make = <A extends ApiConstraint>(
  api: A,
  mode: "Memory" | "History",
): Service<A> => internal.makeService(api, mode);

/**
 * In-memory router — tests, embed, TUI. Path is not bound to `window.history`.
 * Pass a {@link Route.Api} only (use `Group.asRoutes` + `fromEffect` for Groups).
 *
 * @public
 */
export const memory = (api: ApiConstraint): Layer.Layer<Router> =>
  Layer.sync(Router, () => internal.makeService(api, "Memory"));

/**
 * Browser History router — `pushState` / `popstate` / `replaceState` against the catalog.
 * Pass a {@link Route.Api} only (use `Group.asRoutes` + `fromEffect` for Groups).
 *
 * @public
 */
export const history = (api: ApiConstraint): Layer.Layer<Router> =>
  Layer.sync(Router, () => internal.makeService(api, "History"));

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
    if (value.mode !== "History" || typeof window === "undefined") return;
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
export const Link = <A extends ApiConstraint = ApiConstraint>(props: {
  readonly to: string | ((urls: Route.UrlBuilder<A>) => string);
  readonly replace?: boolean;
  readonly children: React.ReactNode;
  readonly className?: string;
  readonly title?: string;
  readonly "data-kind"?: string;
  readonly onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  readonly "aria-current"?: React.AriaAttributes["aria-current"];
}): React.ReactElement => {
  const router = useRouter();
  const href =
    typeof props.to === "function"
      ? props.to(router.urls as Route.UrlBuilder<A>)
      : props.to;
  return React.createElement(
    "a",
    {
      href,
      className: props.className,
      title: props.title,
      "data-kind": props["data-kind"],
      "aria-current": props["aria-current"],
      onClick: (event: React.MouseEvent<HTMLAnchorElement>) => {
        props.onClick?.(event);
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

/**
 * Render the matched route’s {@link Route.handle}. Returns `null` when there is
 * no match or the destination has no handler.
 *
 * ```tsx
 * <Router.Provider value={router}>
 *   <Router.Outlet />
 * </Router.Provider>
 * ```
 *
 * @public
 */
const queryFromSearch = (search: string): Record<string, string> => {
  if (search.length === 0) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(search)) {
    out[key] = value;
  }
  return out;
};

export const Outlet = (): React.ReactElement | null => {
  const router = useRouter();
  const match = router.match;
  const handler = Route.handleOf(match);
  if (match === undefined || handler === undefined) return null;
  const node = handler({
    params: match.params,
    query: queryFromSearch(router.search),
    pathname: match.pathname,
    href: router.href,
  });
  if (node === null || node === undefined || typeof node === "boolean") {
    return null;
  }
  if (React.isValidElement(node)) return node;
  return React.createElement(React.Fragment, null, node);
};

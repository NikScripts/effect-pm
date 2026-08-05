/**
 * @module Router
 *
 * UI route **catalog** (`HttpApi` analogue) + live nav React bindings.
 *
 * ```ts
 * class Site extends Router.make("site").add(
 *   Router.group("marketing", { topLevel: true }).add(
 *     Route.get("home", "/"),
 *   ),
 * ) {}
 *
 * const marketing = RouterBuilder.group(Site, "marketing", Layout, (h) =>
 *   h.handle("home", Home),
 * )
 * const routes = RouterBuilder.layer(Site).pipe(Layer.provide(marketing))
 * export const provider = Last.provider(
 *   History.layer.pipe(Layer.provide(routes)),
 * )
 * ```
 *
 * @see docs/handoffs/router-httpapi-lock.md
 */
import * as React from "react";
import { Context, Layer } from "effect";
import type { HttpApi, HttpApiGroup } from "effect/unstable/httpapi";
import * as fileRouter from "./internal/fileRouter";
import * as internal from "./internal/router";
import * as catalog from "./internal/routes";
import type { ApiConstraint } from "./internal/routes";
import * as Route from "./Route";

// =============================================================================
// Catalog (`HttpApi`)
// =============================================================================

/** @public */
export type Api<
  Id extends string = string,
  Groups extends catalog.GroupTop = never,
> = catalog.Api<Id, Groups>;

/** @public */
export type Group<
  Id extends string = string,
  Routes extends Route.Constraint = never,
  Groups extends catalog.GroupTop = never,
  TopLevel extends boolean = boolean,
> = catalog.Group<Id, Routes, Groups, TopLevel>;

/** @public */
export type GroupTop = catalog.GroupTop;

/** @public */
export type { ApiConstraint };

/** Empty catalog — `HttpApi.make`. @public */
export const make: typeof catalog.make = catalog.make;

/** Named group — `HttpApiGroup.make`. @public */
export const group: typeof catalog.group = catalog.group;

/** @public */
export const isApi: typeof catalog.isApi = catalog.isApi;

/** @public */
export const isGroup: typeof catalog.isGroup = catalog.isGroup;

/**
 * Flatten an Effect `HttpApi` into a group bag (`HttpApi.addHttpApi`).
 *
 * @public
 */
export const addHttpApi: <
  Id extends string,
  Groups extends HttpApiGroup.Constraint,
>(
  api: HttpApi.HttpApi<Id, Groups>,
) => catalog.GroupTop = catalog.addHttpApi;

/** @public */
export const match: typeof catalog.match = catalog.match;

/** @public */
export const flatten: typeof catalog.flatten = catalog.flatten;

/** @public */
export const reflect: typeof catalog.reflect = catalog.reflect;

/**
 * Effect of endpoints from a file-router table (for `fromEffect` / tooling).
 * Prefer {@link layerDestinations} with `group.from(Service)`.
 *
 * @public
 */
export const destinations: typeof fileRouter.fileSystem = fileRouter.fileSystem;

/**
 * Sync endpoint list from a file-router table.
 *
 * @public
 */
export const destinationsOf: typeof fileRouter.destinationsOf =
  fileRouter.destinationsOf;

/**
 * `Layer.succeed(tag, destinationsOf(entries))` for `group.from(tag)`.
 *
 * @public
 */
export const layerDestinations: typeof fileRouter.layerDestinations =
  fileRouter.layerDestinations;

/** @public */
export type PathEntry = fileRouter.PathEntry;

/** @public */
export type RoutesOf<Entries extends ReadonlyArray<fileRouter.PathEntry>> =
  fileRouter.RoutesOf<Entries>;

// =============================================================================
// Types
// =============================================================================

/**
 * Live navigation API — provide with {@link memory} / {@link history}, or build
 * with {@link make} for a catalog-typed surface. Discriminated by `_tag`
 * (`"Memory"` / `"History"` / `"Waku"`).
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
  "last-ts/Router",
) {}

// =============================================================================
// Legacy live Layers (prefer Memory.layer / History.layer + RouterBuilder)
// =============================================================================

/**
 * Live Memory service value — prefer {@link ./Memory.layer} + {@link ./RouterBuilder}.
 *
 * @public
 */
export const unsafeService = <A extends ApiConstraint>(
  api: A,
  engine: "Memory" | "History",
): Service<A> => internal.makeService(api, engine);

/**
 * In-memory router Layer from a catalog value (legacy). Prefer
 * {@link ./Memory.layer} with {@link ./RouterBuilder.layer}.
 *
 * @public
 */
export const memory = (api: ApiConstraint): Layer.Layer<Router> =>
  Layer.sync(Router, () => internal.makeService(api, "Memory"));

/**
 * Browser History router Layer from a catalog value (legacy). Prefer
 * {@link ./History.layer} with {@link ./RouterBuilder.layer}.
 *
 * @public
 */
export const history = (api: ApiConstraint): Layer.Layer<Router> =>
  Layer.sync(Router, () => internal.makeService(api, "History"));

/**
 * Typed destinations from a file-router path table.
 *
 * @public
 */
export const fileSystem: typeof fileRouter.fileSystem = fileRouter.fileSystem;

// =============================================================================
// React
// =============================================================================

const RouterReactContext = React.createContext<Service | null>(null);

/**
 * Provide a live {@link Service} to descendant View provides / shells.
 *
 * @public
 */
export const Provider = (props: {
  readonly value: Service;
  readonly children: React.ReactNode;
}): React.ReactElement => {
  const { value } = props;
  React.useEffect(() => {
    if (value._tag !== "History" || typeof window === "undefined") return;
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
 * Render the matched route’s page. Prefers {@link ./RouterBuilder} handlers
 * (+ group layout). Falls back to legacy {@link Route.handle} annotations.
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
  if (match === undefined) return null;

  const args: Route.HandleArgs = {
    params: match.params,
    query: queryFromSearch(router.search),
    pathname: match.pathname,
    href: router.href,
  };

  // RouterBuilder handlers (+ optional layout)
  const bag = router._handlers;
  if (bag !== undefined) {
    const resolved = (() => {
      const impl = bag.groups.get(match.group.identifier);
      if (impl === undefined) return null;
      const h = impl.handlers.get(match.route.identifier);
      if (h === undefined) return null;
      return {
        page: h.page,
        layout: h.layout === false ? null : impl.layout,
      };
    })();
    if (resolved !== null) {
      const page = React.createElement(resolved.page, args);
      if (resolved.layout !== null) {
        return React.createElement(resolved.layout, { children: page });
      }
      return page;
    }
  }

  // Legacy Route.handle annotation
  const handler = Route.handleOf(match);
  if (handler === undefined) return null;
  const node = handler(args);
  if (node === null || node === undefined || typeof node === "boolean") {
    return null;
  }
  if (React.isValidElement(node)) return node;
  return React.createElement(React.Fragment, null, node);
};

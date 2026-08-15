/**
 * @module Router
 *
 * UI route **catalog** (`HttpApi` analogue) + live nav React bindings.
 *
 * ```ts
 * class Site extends Router.make("site").add(
 *   Router.group("app").add(
 *     Route.get("home", "/"), // Page success
 *     HttpApiEndpoint.get("getUser", "/users/:id", { success: User }),
 *   ),
 * ) {}
 *
 * const app = pipe(
 *   RouterBuilder.group(Site, "app", (h) =>
 *     h.handle("home", Home).handle("getUser", (req) => Effect.succeed(…)),
 *   ),
 *   Layout.provide(AppLayout),
 * )
 * const routes = pipe(RouterBuilder.layer(Site), Layer.provide(app))
 * export const provider = Last.provider(
 *   pipe(History.layer, Layer.provide(routes)),
 * )
 * ```
 *
 * @see docs/handoffs/router-httpapi-lock.md
 */
import * as React from "react";
import { Context } from "effect";
import type { HttpApi, HttpApiGroup } from "effect/unstable/httpapi";
import * as fileRouter from "./internal/fileRouter";
import * as outlet from "./internal/outlet";
import * as internal from "./internal/router";
import * as catalog from "./internal/routes";
import type { ApiConstraint } from "./internal/routes";
import * as linkRender from "./internal/linkRender";
import * as Route from "./Route";

// =============================================================================
// Catalog (`HttpApi`)
// =============================================================================

/** @public */
export type Api<
  Id extends string = string,
  Groups extends catalog.GroupTop = never,
  R = never,
  DeferredGroups extends catalog.GroupTop = never,
> = catalog.Api<Id, Groups, R, DeferredGroups>;

export declare namespace Api {
  export type Context<A> = catalog.Api.Context<A>;
  export type DeferredGroups<A> = catalog.Api.DeferredGroups<A>;
}

/** @public */
export type Group<
  Id extends string = string,
  Routes extends Route.Constraint = never,
  Groups extends catalog.GroupTop = never,
  TopLevel extends boolean = boolean,
  R = never,
  Ctx = never,
> = catalog.Group<Id, Routes, Groups, TopLevel, R, Ctx>;

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
 * Flatten an Effect `HttpApi` into a top-level group bag for `.add`
 * (`HttpApi.addHttpApi` analogue — URL surface only).
 *
 * Prefer mixing directly on the catalog:
 * `Router.make("site").add(HttpApiGroup.make("users").add(...), Router.group(...))`
 * or `Router.make("site").addHttpApi(api)`.
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
 * Effect of endpoints from a file-router table (for `effect` / tooling).
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

/** Glob key → `/guides/[slug]` filePath. @public */
export const filePathFromGlobKey: typeof fileRouter.filePathFromGlobKey =
  fileRouter.filePathFromGlobKey;

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

/**
 * Typed page props from a catalog: `Router.PageProps<typeof Site, "docs", "chapter">`.
 *
 * @public
 */
export type PageProps<
  Api extends {
    readonly groups: Record<
      string,
      { readonly routes: Record<string, unknown> }
    >;
  },
  GroupId extends keyof Api["groups"] & string,
  EndpointId extends keyof Api["groups"][GroupId]["routes"] & string,
> = Route.PageProps<Api, GroupId, EndpointId>;

// =============================================================================
// Types
// =============================================================================

/**
 * Live navigation API — install with {@link ./Memory.fromApi} /
 * {@link ./History.fromApi} / {@link ./Waku.fromApi} (or `.layer` +
 * {@link ./RouterBuilder}), under {@link ./Last.provider}. Discriminated by
 * `_tag` (`"Memory"` / `"History"` / `"Waku"`).
 *
 * @public
 */
export type Service<A extends ApiConstraint = ApiConstraint> =
  internal.Service<A>;

/** Typed service for a concrete catalog (`HttpApiClient.ForApi` analogue). @public */
export type ForApi<A extends ApiConstraint> = Service<A>;

/**
 * Router Context service — provide via Memory / History / Waku Layers.
 *
 * @public
 */
export { Router } from "./internal/routerTag";

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
 * Provide a live {@link Service} to descendant Views.
 * Prefer {@link ./Last.provider} (`Memory` / `History` / `Waku` Layers) at the
 * app edge — this is the React context mount used under that bake.
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
 * Props for a catalog Link from {@link link}.
 *
 * @public
 */
export type LinkProps<A extends ApiConstraint> = {
  readonly to?:
    | catalog.ToHref<A>
    | ((urls: Route.UrlBuilder<A>) => catalog.ToHref<A>);
  readonly out?: string;
  readonly replace?: boolean;
  readonly children?: React.ReactNode;
  readonly className?: string;
  readonly title?: string;
  readonly "data-kind"?: string;
  readonly onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  readonly "aria-current"?: React.AriaAttributes["aria-current"];
};

/**
 * Soft-nav / external link component closed over catalog `A`.
 * Soft-nav runs {@link ./Link.To}; external runs {@link ./Link.Out}; chrome is
 * {@link ./Link.View}.
 *
 * @public
 */
export type LinkComponent<A extends ApiConstraint> = (
  props: LinkProps<A>,
) => React.ReactElement;

/**
 * Derive a typesafe Link for a catalog — same module as the router.
 *
 * ```ts
 * export class App extends Router.make("app").add(…) {}
 * export const Link = Router.link(App)
 *
 * <Link to="/">Home</Link>
 * <Link to={(u) => u.docs.chapter("routing")}>Routing</Link>
 * <Link out="https://effect.website">Effect</Link>
 * ```
 *
 * `to` is {@link Route.PathsOf} / urlBuilder result / `(urls) => …` only —
 * never bare `string`. Free-form URLs use `out`.
 *
 * @public
 */
export const link = <A extends ApiConstraint>(
  api: A,
): LinkComponent<A> => {
  const Link = (props: LinkProps<A>): React.ReactElement => {
    const router = useRouter();
    return linkRender.useRenderLink(
      props as linkRender.RenderLinkProps<A>,
      router.urls as Route.UrlBuilder<A>,
      router,
    );
  };
  Link.displayName = `Router.link(${api.identifier})`;
  return Link;
};

/**
 * Props for {@link UnboundLink} — string `to` (Last.link / internal).
 * App navigation should use {@link link}`(YourCatalog)`.
 *
 * @internal
 */
export type UnboundLinkProps = {
  readonly to?: string | ((urls: Route.UrlBuilderLoose) => string);
  readonly out?: string;
  readonly replace?: boolean;
  readonly children?: React.ReactNode;
  readonly className?: string;
  readonly title?: string;
  readonly "data-kind"?: string;
  readonly onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  readonly "aria-current"?: React.AriaAttributes["aria-current"];
};

/**
 * Untyped soft-nav renderer (Last.link / internal). Prefer {@link link}.
 *
 * @internal
 */
export const UnboundLink = (props: UnboundLinkProps): React.ReactElement => {
  const router = useRouter();
  return linkRender.useRenderLink(
    props,
    router.urls as Route.UrlBuilderLoose,
    router,
  );
};

/**
 * Render the matched route’s page. Prefers {@link ./RouterBuilder} handlers
 * (+ group layout). Provides {@link ./Page.Request}. Document writes use
 * {@link ./Page.document} + {@link ./Document.Cell} under {@link ./Last.provider}.
 * bridges. Falls back to legacy {@link Route.handle} annotations.
 *
 * Layout = component + `children`.
 *
 * ```tsx
 * <Router.Provider value={router}>
 *   <Router.Outlet />
 * </Router.Provider>
 * ```
 *
 * @public
 */
export const Outlet = (): React.ReactElement | null => {
  const router = useRouter();
  return React.createElement(outlet.Outlet, { router });
};

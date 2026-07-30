/**
 * @module ui/Router (docs site)
 *
 * Same shape as package `hyperlink-ts/ui/Router` — `make` / `Provider` / `Link` /
 * `useRouter` / `to` / `go` — with Waku as the navigation engine.
 *
 * ```tsx
 * import { site } from "../lib/siteRoutes"
 * import * as Router from "hyperlink-ts/ui/Router"
 *
 * const router = Router.make(site)
 *
 * <Router.Provider value={router}>
 *   <Router.Link to={(u) => u.home()}>Home</Router.Link>
 *   <Router.Link to={(u) => u.docs("work-pools")}>Work pools</Router.Link>
 *   <Router.Link to={(u) => u.api.symbol("effect", "Effect.succeed")}>
 *     Effect.succeed
 *   </Router.Link>
 * </Router.Provider>
 *
 * const r = Router.useRouter()
 * void r.to((u) => u.api.symbol("hyperlink-ts", "WorkPool", "Tag"))
 * ```
 *
 * Vite aliases `hyperlink-ts/ui/Router` → this file. Page bodies stay in
 * `src/pages/` (Twoslash SSG/SSR); {@link Outlet} is a no-op here.
 */
"use client";

import * as React from "react";
import * as Option from "effect/Option";
import * as Route from "hyperlink-ts/ui/Route";
import {
  Link as WakuLink,
  useRouter as useWakuRouter,
} from "waku/router/client";
import {
  requireSitePath,
  site as defaultSite,
  siteHref,
  urls as defaultUrls,
  type Site,
  type Urls,
} from "../lib/siteRoutes.js";

export type { Urls, Site };

// =============================================================================
// make / Service — vision Router.make(site)
// =============================================================================

export type Service = {
  readonly api: Site;
  readonly mode: "waku";
  readonly urls: Urls;
};

/**
 * Bind a {@link Site} catalog — same role as package `Router.make(api, "history")`.
 * Navigation is Waku; `urls` is the positional path skin for `Link` / `to`.
 */
export const make = (api: Site, skin: Urls = defaultUrls): Service => ({
  api,
  mode: "waku",
  urls: skin,
});

/** Default docs router — `Router.make(site)`. */
export const docs: Service = make(defaultSite);

// =============================================================================
// Provider
// =============================================================================

const CatalogContext = React.createContext<Service | null>(null);

export const Provider = (props: {
  readonly value: Service;
  readonly children: React.ReactNode;
}): React.ReactElement =>
  React.createElement(
    CatalogContext.Provider,
    { value: props.value },
    props.children,
  );

const useCatalog = (): Service => React.useContext(CatalogContext) ?? docs;

// =============================================================================
// useRouter / Link / Outlet
// =============================================================================

export type LiveRouter = Service & {
  readonly pathname: string;
  readonly search: string;
  readonly href: string;
  readonly match: Route.Match | undefined;
  readonly go: (
    href: string,
    options?: { readonly replace?: boolean },
  ) => Promise<void>;
  readonly to: (
    build: (urls: Urls) => string,
    options?: { readonly replace?: boolean },
  ) => Promise<void>;
  readonly back: () => void;
  readonly prefetch: (href: string) => void;
};

export const useRouter = (): LiveRouter => {
  const catalog = useCatalog();
  const waku = useWakuRouter();
  const pathname = waku.path || "/";
  const search =
    typeof window === "undefined" ? "" : window.location.search;
  const href = search.length === 0 ? pathname : `${pathname}${search}`;
  const match = Option.getOrUndefined(Route.match(catalog.api, pathname));

  const go = React.useCallback(
    async (
      next: string,
      options?: { readonly replace?: boolean },
    ): Promise<void> => {
      const target = siteHref(next) as Parameters<typeof waku.push>[0];
      if (options?.replace === true) await waku.replace(target);
      else await waku.push(target);
    },
    [waku],
  );

  const to = React.useCallback(
    async (
      build: (urls: Urls) => string,
      options?: { readonly replace?: boolean },
    ): Promise<void> => go(build(catalog.urls), options),
    [catalog.urls, go],
  );

  return {
    ...catalog,
    pathname,
    search,
    href,
    match,
    go,
    to,
    back: () => {
      waku.back();
    },
    prefetch: (next: string) => {
      waku.prefetch(requireSitePath(next));
    },
  };
};

export const useHasRouter = (): boolean =>
  React.useContext(CatalogContext) !== null;

export const useMatch = (): Route.Match | undefined => useRouter().match;

/**
 * In-app link — `to={(u) => u.docs("work-pools")}`. Soft-nav via Waku.
 */
export const Link = (props: {
  readonly to: string | ((urls: Urls) => string);
  readonly replace?: boolean;
  readonly children: React.ReactNode;
  readonly className?: string;
  readonly onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  readonly "aria-current"?: React.AriaAttributes["aria-current"];
}): React.ReactElement => {
  const catalog = useCatalog();
  const waku = useWakuRouter();
  const href =
    typeof props.to === "function" ? props.to(catalog.urls) : props.to;
  const wakuTo = siteHref(href) as Parameters<typeof waku.push>[0];
  const ariaCurrent = props["aria-current"];

  if (props.replace === true) {
    return (
      <a
        href={wakuTo}
        className={props.className}
        aria-current={ariaCurrent}
        onClick={(event) => {
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
          void waku.replace(wakuTo);
        }}
      >
        {props.children}
      </a>
    );
  }

  return (
    <WakuLink
      to={wakuTo}
      className={props.className}
      aria-current={ariaCurrent}
      onClick={props.onClick}
    >
      {props.children}
    </WakuLink>
  );
};

/** No-op — document bodies are Waku file routes (Twoslash SSG/SSR). */
export const Outlet = (): null => null;

export { defaultSite as site, defaultUrls as urls };

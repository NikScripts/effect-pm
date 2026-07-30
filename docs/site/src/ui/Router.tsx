/**
 * @module ui/Router (docs site)
 *
 * Vision API (`make` / `Provider` / `Link` / `useRouter` / `to` / `go`) with
 * **Waku** as the engine. Same call shape as `hyperlink-ts/ui/Router`.
 *
 * Vite aliases `hyperlink-ts/ui/Router` → this file inside `docs/site`.
 *
 * ```tsx
 * <Router.Provider value={Router.docs}>
 *   <Router.Link to={(u) => u.docs({ params: { chapter: "work-pools" }})}>
 *     Work pools
 *   </Router.Link>
 * </Router.Provider>
 *
 * const r = Router.useRouter()
 * void r.to((u) =>
 *   u.apiSymbol({ params: { pkg: "effect", module: "Effect", symbol: "succeed" } }),
 * )
 * ```
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
  urls as defaultUrls,
  type Site,
} from "../lib/siteRoutes.js";

export type Urls = Route.UrlBuilder<Site>;

export type Service = {
  readonly api: Site;
  readonly mode: "waku";
  readonly urls: Urls;
};

export const make = (api: Site): Service => ({
  api,
  mode: "waku",
  urls: Route.urlBuilder(api),
});

export const docs: Service = make(defaultSite);

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

export type LiveRouter = Service & {
  readonly pathname: string;
  readonly match: Route.Match | undefined;
  readonly go: (
    pathname: string,
    options?: { readonly replace?: boolean },
  ) => Promise<void>;
  readonly to: (
    build: (urls: Urls) => string,
    options?: { readonly replace?: boolean },
  ) => Promise<void>;
  readonly back: () => void;
  readonly prefetch: (pathname: string) => void;
};

export const useRouter = (): LiveRouter => {
  const catalog = useCatalog();
  const waku = useWakuRouter();
  const pathname = waku.path || "/";
  const match = Option.getOrUndefined(Route.match(catalog.api, pathname));

  const go = React.useCallback(
    async (
      next: string,
      options?: { readonly replace?: boolean },
    ): Promise<void> => {
      const target = requireSitePath(next);
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
  const wakuTo = requireSitePath(href);
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

/** No-op — document bodies stay Waku file routes (Twoslash SSG/SSR). */
export const Outlet = (): null => null;

export { defaultSite as site, defaultUrls as urls };

/**
 * Docs site {@link hyperlink-ts/ui/Route} catalog — same destinations as Waku
 * `src/pages/` (static SSG + dynamic SSR). Navigation uses the vision
 * {@link ../ui/Router} API; Waku is the engine underneath.
 */
import { Schema } from "effect";
import * as Route from "hyperlink-ts/ui/Route";
import type { Unstable_InferredPaths as WakuPath } from "waku/router/client";
import "../pages.gen.js";

/**
 * Site catalog — mirrors `pages.gen.ts`.
 *
 * - **Static:** `/`, `/search`, `/releases`, `/api`, literal redirects, …
 * - **Dynamic:** `/docs/:chapter`, `/api/:pkg/:module/:symbol`, …
 *
 * Own-package API URLs (`/api/hyperlink-ts/...`) share the symbol path shape;
 * Waku’s literal `hyperlink-ts` segment selects the SSG page over dep SSR.
 */
export const site = Route.make("docsSite").add(
  Route.get("home", "/"),
  Route.get("search", "/search"),
  Route.get("releases", "/releases"),
  Route.get("notFound", "/404"),
  Route.get("api", "/api"),
  Route.get("docsHyperlinks", "/docs/hyperlinks"),
  Route.get("docsResources", "/docs/resources"),
  Route.get("docs", "/docs/:chapter").pipe(
    Route.params(Schema.Struct({ chapter: Schema.String })),
  ),
  Route.get("apiPkg", "/api/:pkg").pipe(
    Route.params(Schema.Struct({ pkg: Schema.String })),
  ),
  Route.get("apiModule", "/api/:pkg/:module").pipe(
    Route.params(
      Schema.Struct({ pkg: Schema.String, module: Schema.String }),
    ),
  ),
  Route.get("apiSymbol", "/api/:pkg/:module/:symbol").pipe(
    Route.params(
      Schema.Struct({
        pkg: Schema.String,
        module: Schema.String,
        symbol: Schema.String,
      }),
    ),
  ),
);

export type Site = typeof site;

/** Typed URL builder — vision `Router.Link to={(u) => u.docs(...)}` / `router.to`. */
export const urls = Route.urlBuilder(site);

/** Waku `Link` / `push` path union (from file routes). */
export type SitePath = WakuPath;

/** Narrow a catalog href to a Waku path (rejects junk; no `as` cast). */
export const isSitePath = (href: string): href is SitePath => {
  if (
    href === "/" ||
    href === "/search" ||
    href === "/releases" ||
    href === "/404" ||
    href === "/api" ||
    href === "/docs/hyperlinks" ||
    href === "/docs/resources"
  ) {
    return true;
  }
  if (href.startsWith("/docs/") && href.length > "/docs/".length) return true;
  if (href.startsWith("/api/") && href.length > "/api/".length) return true;
  return false;
};

export const requireSitePath = (href: string): SitePath => {
  if (isSitePath(href)) return href;
  throw new Error(`Router: not a docs site path: ${href}`);
};

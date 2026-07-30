/**
 * Docs site routes — typed **path skin** over Waku file routes.
 *
 * Segments are arguments (part of the path), not `{ params: … }`:
 *
 * ```ts
 * urls.home()
 * urls.docs("work-pools")
 * urls.api.symbol("effect", "Effect", "succeed")
 * ```
 *
 * {@link ../ui/Router} is the vision nav API; Waku is the real router underneath.
 */
import { Schema } from "effect";
import * as Route from "hyperlink-ts/ui/Route";
import type { Unstable_InferredPaths as WakuPath } from "waku/router/client";
import "../pages.gen.js";

// =============================================================================
// Path skin (what call sites use)
// =============================================================================

/**
 * Beautifully typed hrefs for every Waku page pattern.
 * Return types are template literals ⊆ Waku `Link` / `push` paths.
 */
export const urls = {
  home: (): "/" => "/",
  search: (): "/search" => "/search",
  releases: (): "/releases" => "/releases",
  notFound: (): "/404" => "/404",
  /** SSG chapter — `/docs/:chapter` */
  docs: (chapter: string): `/docs/${string}` => `/docs/${chapter}`,
  docsHyperlinks: (): "/docs/hyperlinks" => "/docs/hyperlinks",
  docsResources: (): "/docs/resources" => "/docs/resources",
  /** `/api` index + nested package / module / symbol segments */
  api: Object.assign((): "/api" => "/api", {
    pkg: (pkg: string): `/api/${string}` => `/api/${pkg}`,
    module: (
      pkg: string,
      module: string,
    ): `/api/${string}/${string}` => `/api/${pkg}/${module}`,
    /** Own package (SSG) or dep (SSR) — same path shape; Waku picks the page. */
    symbol: (
      pkg: string,
      module: string,
      symbol: string,
    ): `/api/${string}/${string}/${string}` =>
      `/api/${pkg}/${module}/${symbol}`,
  }),
} as const;

export type Urls = typeof urls;

/** Waku `Link` / `push` path union (from `pages.gen.ts`). */
export type SitePath = WakuPath;

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

// =============================================================================
// Match catalog (Route.match) — mirrors the same paths; not the call-site API
// =============================================================================

/**
 * Internal catalog for pathname → match. Call sites use {@link urls}, not
 * `Route.urlBuilder`’s `{ params }` shape.
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

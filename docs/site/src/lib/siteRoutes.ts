/**
 * Typed site routes — hyperlink `Route` catalog **on top of** Waku file routes.
 *
 * | Layer | Owns |
 * |-------|------|
 * | Waku `src/pages/` + `waku/router` | Pages, SSG/SSR, soft-nav, RSC |
 * | This module | Typed hrefs (`path` / `urls`) for those same URLs |
 * | {@link ../components/SiteLink} | Waku `Link` with typed `to` |
 *
 * Static and dynamic Waku routes are both declared here. `path.*` returns
 * template literals assignable to Waku `Link`/`push` with **no casts**.
 */
import { Schema } from "effect";
import * as Route from "hyperlink-ts/ui/Route";
import type { Unstable_InferredPaths as WakuPath } from "waku/router/client";
// Augment `waku/router` RouteConfig.paths (static + dynamic from file routes).
import "../pages.gen.js";

// =============================================================================
// Catalog (mirrors `pages.gen.ts` — static literals + dynamic slugs)
// =============================================================================

/**
 * Site catalog — one entry per Waku page pattern.
 *
 * - **Static:** `/`, `/search`, `/releases`, `/api`, redirect literals, …
 * - **Dynamic:** `/docs/:chapter`, `/api/:pkg/:module/:symbol`, …
 *
 * hyperlink-ts own API symbols are still `/api/hyperlink-ts/...` — same URL
 * shape as the dynamic dep route; Waku picks the static file route by segment.
 */
export const site = Route.make("docsSite").add(
  Route.get("home", "/"),
  Route.get("search", "/search"),
  Route.get("releases", "/releases"),
  Route.get("notFound", "/404"),
  Route.get("api", "/api"),
  // Literal redirect pages (out-match `/docs/:chapter` in Waku)
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

/** Catalog UrlBuilder — hover / tests / `Router.make(site)` dogfood. */
export const urls = Route.urlBuilder(site);

// =============================================================================
// Waku-assignable path builders (template literals ⊆ WakuPath)
// =============================================================================

/** Concrete href Waku `Link` / `push` accept (from `pages.gen.ts`). */
export type SitePath = WakuPath;

/**
 * Typed href builders for Waku navigation.
 *
 * Prefer `path` at call sites that feed {@link ../components/SiteLink} or
 * `useRouter().push`. Return types are template literals that **extend**
 * {@link SitePath} — no assertions.
 *
 * @example
 * path.home()
 * path.docs("work-pools")
 * path.apiSymbol("hyperlink-ts", "WorkPool", "Tag")
 * path.apiSymbol("effect", "Effect", "succeed") // dynamic SSR route
 */
export const path = {
  home: (): "/" => "/",
  search: (): "/search" => "/search",
  releases: (): "/releases" => "/releases",
  notFound: (): "/404" => "/404",
  api: (): "/api" => "/api",
  docsHyperlinks: (): "/docs/hyperlinks" => "/docs/hyperlinks",
  docsResources: (): "/docs/resources" => "/docs/resources",
  docs: (chapter: string): `/docs/${string}` => `/docs/${chapter}`,
  apiPkg: (pkg: string): `/api/${string}` => `/api/${pkg}`,
  apiModule: (
    pkg: string,
    module: string,
  ): `/api/${string}/${string}` => `/api/${pkg}/${module}`,
  apiSymbol: (
    pkg: string,
    module: string,
    symbol: string,
  ): `/api/${string}/${string}/${string}` =>
    `/api/${pkg}/${module}/${symbol}`,
} as const;

export type Path = typeof path;

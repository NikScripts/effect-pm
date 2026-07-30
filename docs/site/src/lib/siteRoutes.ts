/**
 * Typed docs catalog — **same `Route.make` API** as any hyperlink app.
 *
 * Call sites navigate with {@link ../ui/Router} (`Link` / `to` / `useRouter`).
 * Path segments are arguments on `urls` (not `{ params }`); Waku owns the real
 * file-route match + RSC/SSG render.
 *
 * ```ts
 * import { site, urls } from "./siteRoutes"
 * import * as Router from "../ui/Router"
 *
 * const router = Router.make(site)
 * router.urls.docs("work-pools")
 * router.urls.api.symbol("effect", "Effect.succeed")
 * ```
 */
import { Schema } from "effect";
import * as Route from "hyperlink-ts/ui/Route";
import type { Unstable_InferredPaths as WakuPath } from "waku/router/client";
import "../pages.gen.js";

// =============================================================================
// Typed API — Route.make (the definition)
// =============================================================================

/**
 * Docs site catalog. Mirrors Waku `src/pages/` (static + dynamic).
 *
 * | Identifier | Path | Waku page |
 * |------------|------|-----------|
 * | `home` | `/` | `pages/index` (outside book) / book entry |
 * | `docs` | `/docs/:chapter` | `docs/[chapter].tsx` (SSG) |
 * | `api` / `api.symbol` | `/api/:pkg/:module/:symbol` | static `hyperlink-ts/…` or SSR `[pkg]/…` |
 */
export const site = Route.make("docsSite").add(
  Route.get("home", "/"),
  Route.get("search", "/search"),
  Route.get("releases", "/releases"),
  Route.get("notFound", "/404"),
  Route.get("docsHyperlinks", "/docs/hyperlinks"),
  Route.get("docsResources", "/docs/resources"),
  Route.get("docs", "/docs/:chapter").pipe(
    Route.params(Schema.Struct({ chapter: Schema.String })),
  ),
  Route.group("api").add(
    Route.get("index", "/api"),
    Route.get("pkg", "/api/:pkg").pipe(
      Route.params(Schema.Struct({ pkg: Schema.String })),
    ),
    Route.get("module", "/api/:pkg/:module").pipe(
      Route.params(
        Schema.Struct({ pkg: Schema.String, module: Schema.String }),
      ),
    ),
    Route.get("symbol", "/api/:pkg/:module/:symbol").pipe(
      Route.params(
        Schema.Struct({
          pkg: Schema.String,
          module: Schema.String,
          symbol: Schema.String,
        }),
      ),
    ),
  ),
);

export type Site = typeof site;

// =============================================================================
// urls — positional path skin over `site` (Link / to callbacks)
// =============================================================================

type ApiSymbolPath = `/api/${string}/${string}/${string}`;

function apiSymbol(pkg: string, module: string, symbol: string): ApiSymbolPath;
function apiSymbol(
  pkg: string,
  qualified: `${string}.${string}`,
): ApiSymbolPath;
function apiSymbol(
  pkg: string,
  moduleOrQualified: string,
  symbol?: string,
): ApiSymbolPath {
  if (symbol !== undefined) {
    return `/api/${pkg}/${moduleOrQualified}/${symbol}`;
  }
  const dot = moduleOrQualified.indexOf(".");
  if (dot <= 0 || dot === moduleOrQualified.length - 1) {
    throw new Error(
      `urls.api.symbol: expected "Module.symbol", got ${moduleOrQualified}`,
    );
  }
  return `/api/${pkg}/${moduleOrQualified.slice(0, dot)}/${moduleOrQualified.slice(dot + 1)}`;
}

/**
 * Call-site href builders for {@link site}.
 * Same identifiers as the catalog; path params are **positional args**.
 */
export const urls = {
  home: (): "/" => "/",
  search: (): "/search" => "/search",
  releases: (): "/releases" => "/releases",
  notFound: (): "/404" => "/404",
  docsHyperlinks: (): "/docs/hyperlinks" => "/docs/hyperlinks",
  docsResources: (): "/docs/resources" => "/docs/resources",
  docs: (chapter: string): `/docs/${string}` => `/docs/${chapter}`,
  api: {
    index: (): "/api" => "/api",
    pkg: (pkg: string): `/api/${string}` => `/api/${pkg}`,
    module: (
      pkg: string,
      module: string,
    ): `/api/${string}/${string}` => `/api/${pkg}/${module}`,
    symbol: apiSymbol,
  },
} as const;

export type Urls = typeof urls;

/** Waku `Link` / `push` path union. */
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

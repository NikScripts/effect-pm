/**
 * Typed docs catalog — **same `Route.make` API** as any hyperlink app.
 *
 * **SSOT:** {@link destinations} lists every navigable page — Route path + Waku
 * file-route template. Exhaustively checked against `pages.gen` (see
 * `test/site-routes.test-d.ts`). File routes remain render/Twoslash SSOT;
 * this table is the typed nav SSOT.
 *
 * ```ts
 * import { site, urls } from "./siteRoutes"
 * import * as Router from "../ui/Router"
 *
 * const router = Router.make(site)
 * router.urls.docs("work-pools")
 * router.urls.api.symbol("effect", "Effect.succeed")
 * router.urls.search({ query: { q: "WorkPool" } })
 * ```
 */
import { Schema } from "effect";
import * as Route from "hyperlink-ts/ui/Route";
import type { CreatePagesConfig } from "waku/router";
import type { Unstable_InferredPaths as WakuPath } from "waku/router/client";
import "../pages.gen.js";

// =============================================================================
// SSOT — destinations (Route path ↔ Waku file-route template)
// =============================================================================

/**
 * Every navigable docs page. `waku` must match a `pages.gen` `Page.path`.
 * Specialized static sibling `/api/hyperlink-ts/…` is covered by `api.symbol`.
 * `/_root` is layout-only — not listed.
 */
export const destinations = [
  { id: "home", path: "/", waku: "/" },
  { id: "search", path: "/search", waku: "/search" },
  { id: "releases", path: "/releases", waku: "/releases" },
  { id: "notFound", path: "/404", waku: "/404" },
  { id: "docsHyperlinks", path: "/docs/hyperlinks", waku: "/docs/hyperlinks" },
  { id: "docsResources", path: "/docs/resources", waku: "/docs/resources" },
  { id: "docs", path: "/docs/:chapter", waku: "/docs/[chapter]" },
  { id: "api.index", path: "/api", waku: "/api" },
  { id: "api.pkg", path: "/api/:pkg", waku: "/api/[pkg]" },
  { id: "api.module", path: "/api/:pkg/:module", waku: "/api/[pkg]/[module]" },
  {
    id: "api.symbol",
    path: "/api/:pkg/:module/:symbol",
    waku: "/api/[pkg]/[module]/[symbol]",
  },
] as const;

/** Waku `Page.path` union from `pages.gen` module augmentation. */
export type WakuFilePath = CreatePagesConfig extends { pages: infer P }
  ? P extends { path: infer Path } ? Path
  : never
  : never;

/** Paths this catalog claims to cover. */
export type CatalogWakuPath = (typeof destinations)[number]["waku"];

/**
 * File routes we intentionally omit from the nav catalog.
 * - `/_root` — layout chrome
 * - `/api/hyperlink-ts/…` — static specialize of `api.symbol`
 */
export type WakuFilePathExcluded =
  | "/_root"
  | "/api/hyperlink-ts/[module]/[symbol]";

export type WakuFilePathRequired = Exclude<WakuFilePath, WakuFilePathExcluded>;

// =============================================================================
// Typed API — Route.make (built to match {@link destinations})
// =============================================================================

/**
 * Docs site catalog. Mirrors Waku `src/pages/` via {@link destinations}.
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
// urls — package UrlBuilder + branded returns + Module.symbol sugar
// =============================================================================

const build = Route.urlBuilder(site);

type ApiSymbolPath = `/api/${string}/${string}/${string}`;

function apiSymbol(
  pkg: string,
  module: string,
  symbol: string,
  options?: Route.UrlQueryOptions,
): ApiSymbolPath;
function apiSymbol(
  pkg: string,
  qualified: `${string}.${string}`,
  options?: Route.UrlQueryOptions,
): ApiSymbolPath;
function apiSymbol(
  pkg: string,
  moduleOrQualified: string,
  symbolOrOptions?: string | Route.UrlQueryOptions,
  options?: Route.UrlQueryOptions,
): ApiSymbolPath {
  if (typeof symbolOrOptions === "string") {
    return (
      options === undefined
        ? build.api.symbol(pkg, moduleOrQualified, symbolOrOptions)
        : build.api.symbol(pkg, moduleOrQualified, symbolOrOptions, options)
    ) as ApiSymbolPath;
  }
  const dot = moduleOrQualified.indexOf(".");
  if (dot <= 0 || dot === moduleOrQualified.length - 1) {
    throw new Error(
      `urls.api.symbol: expected "Module.symbol", got ${moduleOrQualified}`,
    );
  }
  const module = moduleOrQualified.slice(0, dot);
  const symbol = moduleOrQualified.slice(dot + 1);
  return (
    symbolOrOptions === undefined
      ? build.api.symbol(pkg, module, symbol)
      : build.api.symbol(pkg, module, symbol, symbolOrOptions)
  ) as ApiSymbolPath;
}

/**
 * Call-site href builders for {@link site}.
 * Same dream call shape as package {@link Route.urlBuilder}.
 */
export const urls = {
  home: (options?: Route.UrlQueryOptions): "/" =>
    (options === undefined ? build.home() : build.home(options)) as "/",
  search: (options?: Route.UrlQueryOptions): "/search" =>
    (options === undefined ? build.search() : build.search(options)) as "/search",
  releases: (options?: Route.UrlQueryOptions): "/releases" =>
    (options === undefined
      ? build.releases()
      : build.releases(options)) as "/releases",
  notFound: (options?: Route.UrlQueryOptions): "/404" =>
    (options === undefined
      ? build.notFound()
      : build.notFound(options)) as "/404",
  docsHyperlinks: (options?: Route.UrlQueryOptions): "/docs/hyperlinks" =>
    (options === undefined
      ? build.docsHyperlinks()
      : build.docsHyperlinks(options)) as "/docs/hyperlinks",
  docsResources: (options?: Route.UrlQueryOptions): "/docs/resources" =>
    (options === undefined
      ? build.docsResources()
      : build.docsResources(options)) as "/docs/resources",
  docs: (
    chapter: string,
    options?: Route.UrlQueryOptions,
  ): `/docs/${string}` =>
    (options === undefined
      ? build.docs(chapter)
      : build.docs(chapter, options)) as `/docs/${string}`,
  api: {
    index: (options?: Route.UrlQueryOptions): "/api" =>
      (options === undefined
        ? build.api.index()
        : build.api.index(options)) as "/api",
    pkg: (pkg: string, options?: Route.UrlQueryOptions): `/api/${string}` =>
      (options === undefined
        ? build.api.pkg(pkg)
        : build.api.pkg(pkg, options)) as `/api/${string}`,
    module: (
      pkg: string,
      module: string,
      options?: Route.UrlQueryOptions,
    ): `/api/${string}/${string}` =>
      (options === undefined
        ? build.api.module(pkg, module)
        : build.api.module(pkg, module, options)) as `/api/${string}/${string}`,
    symbol: apiSymbol,
  },
} as const;

export type Urls = typeof urls;

/** Waku `Link` / `push` path union. */
export type SitePath = WakuPath;

const pathOnly = (href: string): string => {
  const q = href.indexOf("?");
  return q === -1 ? href : href.slice(0, q);
};

export const isSitePath = (href: string): href is SitePath => {
  const path = pathOnly(href);
  if (
    path === "/" ||
    path === "/search" ||
    path === "/releases" ||
    path === "/404" ||
    path === "/api" ||
    path === "/docs/hyperlinks" ||
    path === "/docs/resources"
  ) {
    return true;
  }
  if (path.startsWith("/docs/") && path.length > "/docs/".length) return true;
  if (path.startsWith("/api/") && path.length > "/api/".length) return true;
  return false;
};

export const requireSitePath = (href: string): SitePath => {
  const path = pathOnly(href);
  if (isSitePath(path)) return path;
  throw new Error(`Router: not a docs site path: ${href}`);
};

/** Full href for Waku when the skin produced a query string. */
export const siteHref = (href: string): string => {
  const path = requireSitePath(href);
  const q = href.indexOf("?");
  return q === -1 ? path : `${path}${href.slice(q)}`;
};

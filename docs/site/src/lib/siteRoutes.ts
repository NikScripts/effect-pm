/**
 * Typed docs catalog — **same `Route.make` API** as any hyperlink app.
 *
 * Href builders match the package dream shape (positional path args, optional
 * `{ query }`) via {@link Route.urlBuilder}, with branded path returns for Waku
 * and a `Module.symbol` overload on `api.symbol`.
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

/**
 * Typed docs catalog — last-ts {@link Route.make} / {@link Route.get}.
 *
 * Catalog-only: do **not** import `last-ts/Router` here (it pulls AtomReact /
 * createContext and breaks Waku RSC). Live soft-nav stays on `ui/Router`.
 *
 * **SSOT:** {@link catalog} holds every navigable Route path once. Waku file
 * templates are derived (`:param` → `[param]`). Exhaustively checked against
 * `paths.gen` (last-ts file router) in `test/site-routes.test-d.ts`. File
 * routes remain render / Twoslash SSOT; this catalog is the typed nav SSOT.
 *
 * ```ts
 * import { urls } from "./siteRoutes"
 * import * as Router from "../ui/Router"
 *
 * urls.docs("work-pools")
 * urls.api.symbol("effect", "Effect.succeed")
 * // soft-nav (Waku): <Router.Link to={(u) => u.docs("work-pools")}>…
 * ```
 */
import * as Route from "last-ts/Route";
import type { FilePath } from "../paths.gen.js";

// =============================================================================
// SSOT — path catalog (one string each; Waku templates derived)
// =============================================================================

/**
 * Navigable docs paths. Nested `api` → `Route.group("api")`.
 * Specialized static `/api/hyperlink-ts/…` is covered by `api.symbol`.
 * `/_root` is layout-only — omitted.
 */
export const catalog = {
  home: "/",
  search: "/search",
  releases: "/releases",
  notFound: "/404",
  docsHyperlinks: "/docs/hyperlinks",
  docsResources: "/docs/resources",
  docs: "/docs/:chapter",
  api: {
    index: "/api",
    pkg: "/api/:pkg",
    module: "/api/:pkg/:module",
    symbol: "/api/:pkg/:module/:symbol",
  },
} as const;

/** `:param` / `*param` → Waku `[param]` (type-level). */
export type ToWaku<P extends string> = P extends
  `${infer L}:${infer Param}/${infer R}`
  ? Param extends `${infer Name}?` ? `${L}[${Name}]/${ToWaku<R>}`
  : `${L}[${Param}]/${ToWaku<R>}`
  : P extends `${infer L}:${infer Param}`
    ? Param extends `${infer Name}?` ? `${L}[${Name}]`
    : `${L}[${Param}]`
  : P extends `${infer L}*${infer Splat}` ? `${L}[${Splat}]`
  : P;

type TopId = Exclude<keyof typeof catalog, "api">;
type ApiId = keyof typeof catalog.api;

/** Waku templates claimed by {@link catalog}. */
export type CatalogWakuPath =
  | ToWaku<(typeof catalog)[TopId]>
  | ToWaku<(typeof catalog.api)[ApiId]>;

/** Runtime `:param` / `*param` → `[param]`. */
export const toWaku = (path: string): string =>
  path
    .replace(/:(\w+)\?/g, "[$1]")
    .replace(/:(\w+)/g, "[$1]")
    .replace(/\/\*(\w+)/g, "/[$1]");

/** Flat list for tooling / docs (derived from {@link catalog}). */
export const destinations: ReadonlyArray<{
  readonly id: string;
  readonly path: string;
  readonly waku: string;
}> = [
  ...(Object.keys(catalog) as Array<TopId | "api">)
    .filter((id): id is TopId => id !== "api")
    .map((id) => ({
      id,
      path: catalog[id],
      waku: toWaku(catalog[id]),
    })),
  ...(Object.keys(catalog.api) as Array<ApiId>).map((id) => ({
    id: `api.${id}`,
    path: catalog.api[id],
    waku: toWaku(catalog.api[id]),
  })),
];

/**
 * File paths from the last-ts file router (`paths.gen.ts`, `(book)` group
 * stripped — it never appears in served URLs).
 */
export type WakuFilePath = FilePath;

/**
 * File routes we intentionally omit from the nav catalog.
 * - `/api/hyperlink-ts/…` — static specialize of `api.symbol`
 *
 * (`_root` / `_layout` shells never appear in `paths.gen` — the file router
 * skips `_`-prefixed files.)
 */
export type WakuFilePathExcluded = "/api/hyperlink-ts/[module]/[symbol]";

export type WakuFilePathRequired = Exclude<WakuFilePath, WakuFilePathExcluded>;

// =============================================================================
// Typed API — Route.make from {@link catalog}
// =============================================================================

/**
 * Docs site catalog — paths from {@link catalog} only.
 * Bare endpoints land in the synthetic top-level group; `api` stays nested.
 * (`Route.make` === `Router.make` catalog builder — RSC-safe.)
 */
export const site = Route.make("docsSite").add(
  Route.get("home", catalog.home),
  Route.get("search", catalog.search),
  Route.get("releases", catalog.releases),
  Route.get("notFound", catalog.notFound),
  Route.get("docsHyperlinks", catalog.docsHyperlinks),
  Route.get("docsResources", catalog.docsResources),
  Route.get("docs", catalog.docs),
  Route.group("api").add(
    Route.get("index", catalog.api.index),
    Route.get("pkg", catalog.api.pkg),
    Route.get("module", catalog.api.module),
    Route.get("symbol", catalog.api.symbol),
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

/**
 * Soft-nav `Link` / `push` path union — mirrors {@link isSitePath} /
 * {@link requireSitePath} runtime checks (no `waku/router/client` type import).
 */
export type SitePath =
  | "/"
  | "/search"
  | "/releases"
  | "/404"
  | "/docs/hyperlinks"
  | "/docs/resources"
  | `/docs/${string}`
  | "/api"
  | `/api/${string}`
  | `/api/${string}/${string}`
  | `/api/${string}/${string}/${string}`;

/** Strip `?query` and `#hash` — pathname only. */
export const pathOnly = (href: string): string => {
  const hash = href.indexOf("#");
  const beforeHash = hash === -1 ? href : href.slice(0, hash);
  const q = beforeHash.indexOf("?");
  return q === -1 ? beforeHash : beforeHash.slice(0, q);
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

/**
 * Narrow a runtime href for catalog {@link ./../ui/Router.Link} `to`
 * (`Router.link(site)` — PathsOf only, no bare `string`).
 */
export const asLinkTo = (href: string): import("last-ts/Route").ToHref<Site> =>
  requireSitePath(href);

/**
 * Resolve an in-book href through {@link urls} when it matches a known pattern.
 * Preserves `?query` and `#hash`. Unknown absolute paths pass through.
 */
export const resolveBookHref = (href: string): string => {
  if (href.startsWith("http://") || href.startsWith("https://") || href.startsWith("//")) {
    return href;
  }
  if (href.startsWith("#") || href === "") return href;

  const hashIdx = href.indexOf("#");
  const hash = hashIdx === -1 ? "" : href.slice(hashIdx);
  const beforeHash = hashIdx === -1 ? href : href.slice(0, hashIdx);
  const qIdx = beforeHash.indexOf("?");
  const search = qIdx === -1 ? "" : beforeHash.slice(qIdx);
  const path = qIdx === -1 ? beforeHash : beforeHash.slice(0, qIdx);

  if (path === "/api" || path === "/api/") {
    return `${urls.api.index()}${search}${hash}`;
  }
  if (path === "/releases") return `${urls.releases()}${search}${hash}`;
  if (path === "/search") return `${urls.search()}${search}${hash}`;
  if (path === "/" || path === "") return `${urls.home()}${search}${hash}`;

  const apiSymbol = /^\/api\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(path);
  if (apiSymbol !== null) {
    return `${urls.api.symbol(apiSymbol[1]!, apiSymbol[2]!, apiSymbol[3]!)}${search}${hash}`;
  }
  const apiModule = /^\/api\/([^/]+)\/([^/]+)$/.exec(path);
  if (apiModule !== null) {
    return `${urls.api.module(apiModule[1]!, apiModule[2]!)}${search}${hash}`;
  }
  const apiPkg = /^\/api\/([^/]+)$/.exec(path);
  if (apiPkg !== null) {
    return `${urls.api.pkg(apiPkg[1]!)}${search}${hash}`;
  }
  const docs = /^\/docs\/([^/]+)$/.exec(path);
  if (docs !== null) {
    return `${urls.docs(docs[1]!)}${search}${hash}`;
  }
  return href;
};

/** Full href for Waku — path via catalog check, keep `?` / `#`. */
export const siteHref = (href: string): string => {
  const resolved = resolveBookHref(href);
  const path = requireSitePath(resolved);
  const hashIdx = resolved.indexOf("#");
  const hash = hashIdx === -1 ? "" : resolved.slice(hashIdx);
  const beforeHash = hashIdx === -1 ? resolved : resolved.slice(0, hashIdx);
  const qIdx = beforeHash.indexOf("?");
  const search = qIdx === -1 ? "" : beforeHash.slice(qIdx);
  return `${path}${search}${hash}`;
};

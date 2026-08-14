/**
 * @module ui/Router (docs site)
 *
 * Waku **layer** for location + catalog-derived {@link Link} via
 * `Router.link(site)` (not a Waku Link API).
 */
"use client";

import type { Service as LastRouterService } from "last-ts/Router";
import * as Router from "last-ts/Router";
import * as Waku from "hyperlink-ts/ui/Router/waku";
import {
  site as defaultSite,
  urls as defaultUrls,
  type Site,
  type Urls,
} from "../lib/siteRoutes.js";

export type { Urls, Site };
/** Live router service for the docs catalog (branded {@link Urls}). */
export type Service = LastRouterService<Site>;
export type LiveRouter = Service;

/** Waku layer binding for the docs catalog (branded {@link Urls} skin). */
export const waku = (
  api: Site = defaultSite,
  skin: Urls = defaultUrls,
): Waku.WakuBinding<Site, Urls> => Waku.waku(api, skin);

/**
 * @deprecated Site-skin alias for {@link waku} only — **not** package
 * `hyperlink-ts/ui/Router.make` (lite Memory/History). Prefer {@link waku}.
 */
export const make = waku;

/** Default Waku binding (+ {@link Waku.setDefault}). */
export const docs = waku();
Waku.setDefault(docs);

export const Provider = Waku.Provider;
export const useRouter = Waku.useRouter as () => LiveRouter;
export const useHasRouter = Waku.useHasRouter;
export const useMatch = Waku.useMatch;
/** Catalog Link — soft-nav through the live Service (Waku layer supplies `go`). */
export const Link = Router.link(defaultSite);
/** Waku layer only (`layer.waku`). */
export const layer = Waku.layer;

/** No-op — document bodies are Waku file routes (Twoslash SSG/SSR). */
export const Outlet = (): null => null;

export { defaultSite as site, defaultUrls as urls };

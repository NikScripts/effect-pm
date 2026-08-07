/**
 * @module ui/Router (docs site)
 *
 * Skin: branded `urls` + Waku **layer** (`hyperlink-ts/ui/Router/waku`) +
 * `setDefault` (no layout Provider) + no-op {@link Outlet} for file routes.
 * Lite Memory/History stay on `hyperlink-ts/ui/Router` — this skin only wires
 * the Waku layer.
 *
 * RSC note: pass **string** `to` values into {@link Link} from Server Components
 * (`urls.docs("routing")`). Function builders are client-only.
 */
"use client";

import type { Service as LastRouterService } from "last-ts/Router";
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
export const Link = Waku.Link;
/** Waku layer only (`layer.waku`). */
export const layer = Waku.layer;

/** No-op — document bodies are Waku file routes (Twoslash SSG/SSR). */
export const Outlet = (): null => null;

export { defaultSite as site, defaultUrls as urls };

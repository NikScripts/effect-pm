/**
 * @module ui/Router (docs site)
 *
 * Soft-nav via {@link Router.link}`(site)` under {@link ../islands/RouterProvider}
 * (`Last.provider(Waku.fromApi(…))`). No `setDefault` / nested `Waku.Provider`.
 */
"use client";

import type { Service as LastRouterService } from "last-ts/Router";
import * as Router from "last-ts/Router";
import * as Waku from "last-ts/Waku";
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

/** Catalog Link — soft-nav through the live Service (Waku layer supplies `go`). */
export const Link = Router.link(defaultSite);

export const useRouter = Waku.useRouter as () => LiveRouter;
export const useHasRouter = Waku.useHasRouter;
export const useMatch = Waku.useMatch;

export { defaultSite as site, defaultUrls as urls };

/** @deprecated Prefer {@link Link} / {@link useRouter} under RouterProvider. */
export const waku = (
  api: Site = defaultSite,
  skin: Urls = defaultUrls,
) => Waku.waku(api, skin);

/** No-op — document bodies are Waku file routes (Twoslash SSG/SSR). */
export const Outlet = (): null => null;

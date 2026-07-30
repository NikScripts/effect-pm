/**
 * @module ui/Router (docs site)
 *
 * Thin skin over package **full** Router (`hyperlink-ts/ui/Router/waku`):
 * site catalog + branded `urls`, default binding (no layout Provider), and
 * no-op {@link Outlet} (bodies are Waku file routes / Twoslash SSG).
 */
"use client";

import * as RouterWaku from "hyperlink-ts/ui/Router/waku";
import {
  site as defaultSite,
  urls as defaultUrls,
  type Site,
  type Urls,
} from "../lib/siteRoutes.js";

export type { Urls, Site };
export type Service = RouterWaku.WakuBinding<Site>;
export type LiveRouter = RouterWaku.LiveRouter<Site>;

/** Bind the docs catalog — `Router.make(site)` / `Router.waku(site)`. */
export const make = (
  api: Site = defaultSite,
  skin: Urls = defaultUrls,
): Service => RouterWaku.waku(api, skin);

export const waku = make;

/** Default docs binding — also {@link RouterWaku.setDefault}. */
export const docs: Service = make();
RouterWaku.setDefault(docs);

export const Provider = RouterWaku.Provider;
export const useRouter = RouterWaku.useRouter as () => LiveRouter;
export const useHasRouter = RouterWaku.useHasRouter;
export const useMatch = RouterWaku.useMatch;
export const Link = RouterWaku.Link;

/** No-op — document bodies are Waku file routes (Twoslash SSG/SSR). */
export const Outlet = (): null => null;

export { defaultSite as site, defaultUrls as urls };

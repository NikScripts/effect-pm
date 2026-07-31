/**
 * @module ui/Router (docs site)
 *
 * Skin over the **one** Router service with the Waku layer
 * (`hyperlink-ts/ui/Router/waku`): site catalog + branded `urls`,
 * `setDefault` (no layout Provider), no-op {@link Outlet} for file routes.
 */
"use client";

import * as Router from "hyperlink-ts/ui/Router/waku";
import {
  site as defaultSite,
  urls as defaultUrls,
  type Site,
  type Urls,
} from "../lib/siteRoutes.js";

export type { Urls, Site };
export type Service = Router.Service<Site>;
export type LiveRouter = Router.LiveRouter<Site>;

/** Waku layer binding for the docs catalog (branded {@link Urls} skin). */
export const waku = (
  api: Site = defaultSite,
  skin: Urls = defaultUrls,
): Router.WakuBinding<Site, Urls> => Router.waku(api, skin);

/** @deprecated Prefer {@link waku} — same binding. */
export const make = waku;

/** Default Waku binding (+ {@link Router.setDefault}). */
export const docs = waku();
Router.setDefault(docs);

export const Provider = Router.Provider;
export const useRouter = Router.useRouter as () => LiveRouter;
export const useHasRouter = Router.useHasRouter;
export const useMatch = Router.useMatch;
export const Link = Router.Link;
export const layer = Router.layer;

/** No-op — document bodies are Waku file routes (Twoslash SSG/SSR). */
export const Outlet = (): null => null;

export { defaultSite as site, defaultUrls as urls };

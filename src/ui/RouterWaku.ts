/**
 * @module ui/RouterWaku
 *
 * **Full** Router edition — Waku RSC/SSG/SSR engine. Same typed
 * {@link ./Router.Service} contract as lite {@link ./Router.make}.
 *
 * Companion entry: `hyperlink-ts/ui/Router/waku` (optional `waku` peer).
 * Does not pull into lite `hyperlink-ts/ui/Router` imports.
 *
 * ```tsx
 * import * as Router from "hyperlink-ts/ui/Router/waku"
 *
 * const router = Router.waku(site) // === Router.make(site)
 *
 * <Router.Provider value={router}>
 *   <Router.Link to={(u) => u.home()}>Home</Router.Link>
 *   <Router.Outlet />
 * </Router.Provider>
 * ```
 *
 * Dashboard / GroupNav sit **on top** of either edition — not inside this module.
 *
 * @see docs/handoffs/ui-routes-dream.md
 */
"use client";

import * as internal from "../internal/uiRouterWaku";
import type { ApiConstraint } from "../internal/uiRoutes";
import * as Route from "./Route";
import type { Service } from "./Router";

export type { Service, ForApi } from "./Router";
export type { WakuBinding } from "../internal/uiRouterWaku";

/**
 * Bind a catalog to the Waku engine — full edition constructor.
 * Same role as lite {@link ./Router.make}`(api, "history")`.
 *
 * @public
 */
export const waku: typeof internal.waku = internal.waku;

/**
 * Alias of {@link waku} so `import * as Router from "…/Router/waku"` can use
 * `Router.make(site)` the same way as the lite entry uses `Router.make(site, "history")`.
 *
 * @public
 */
export const make = <A extends ApiConstraint>(
  api: A,
  urls?: Route.UrlBuilder<A>,
): internal.WakuBinding<A> => internal.waku(api, urls);

/** Optional default catalog when no {@link Provider} is mounted. @public */
export const setDefault: typeof internal.setDefault = internal.setDefault;

export const Provider: typeof internal.Provider = internal.Provider;
export const useRouter: typeof internal.useRouter = internal.useRouter;
export const useHasRouter: typeof internal.useHasRouter = internal.useHasRouter;
export const useMatch: typeof internal.useMatch = internal.useMatch;
export const Link: typeof internal.Link = internal.Link;
export const Outlet: typeof internal.Outlet = internal.Outlet;

/** @public */
export type LiveRouter<A extends ApiConstraint = ApiConstraint> = Service<A>;

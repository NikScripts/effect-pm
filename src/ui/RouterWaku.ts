/**
 * @module ui/RouterWaku
 *
 * **Waku layer** for the one {@link ./Router} service. Same `Service` / `Link` /
 * `to` / `go` as lite — this entry adapts Waku into that service (optional `waku`
 * peer). Non-Waku apps import `hyperlink-ts/ui/Router` instead so they never
 * pull Waku.
 *
 * ```tsx
 * import * as Router from "hyperlink-ts/ui/Router/waku"
 *
 * const binding = Router.waku(site) // or Router.layer.waku(site)
 * <Router.Provider value={binding}>…</Router.Provider>
 * ```
 *
 * Hooks require Waku's router in the tree (every Waku app has one).
 *
 * @see docs/handoffs/ui-routes-dream.md
 */
"use client";

import * as internal from "../internal/uiRouterWaku";
import type { ApiConstraint } from "../internal/uiRoutes";
import * as Route from "./Route";
import * as Router from "./Router";

// =============================================================================
// One service — re-export lite surface
// =============================================================================

export type { Service, ForApi } from "./Router";
export type { WakuBinding } from "../internal/uiRouterWaku";

export {
  Router,
  memory,
  history,
  useTarget,
  Outlet,
} from "./Router";

/**
 * Lite live service — `make(api, "Memory" | "History")`.
 * For the Waku layer use {@link waku}.
 *
 * @public
 */
export const make = Router.make;

/**
 * Waku layer input — provide with {@link Provider}. Same typed catalog as lite.
 *
 * @public
 */
export const waku: typeof internal.waku = internal.waku;

/** @public */
export const setDefault: typeof internal.setDefault = internal.setDefault;

/** @public */
export const isWakuBinding: typeof internal.isWakuBinding =
  internal.isWakuBinding;

/**
 * One Provider: lite {@link Service} **or** {@link waku} binding → one Service context.
 *
 * @public
 */
export const Provider: typeof internal.Provider = internal.Provider;

/**
 * The one live {@link Service} (context or default Waku binding).
 *
 * @public
 */
export const useRouter: typeof internal.useRouter = internal.useRouter;

export const useHasRouter: typeof internal.useHasRouter =
  internal.useHasRouter;

export const useMatch: typeof internal.useMatch = internal.useMatch;

export const Link: typeof internal.Link = internal.Link;

/** @public */
export type LiveRouter<A extends ApiConstraint = ApiConstraint> =
  Router.Service<A>;

/** Convenience: `waku(api, urls?)` when you only pass a catalog. @public */
export const layer = {
  memory: Router.memory,
  history: Router.history,
  waku: <A extends ApiConstraint, U = Route.UrlBuilder<A>>(
    api: A,
    urls?: U,
  ): internal.WakuBinding<A, U> => internal.waku(api, urls),
} as const;

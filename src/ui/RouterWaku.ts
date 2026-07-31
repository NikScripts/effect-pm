/**
 * @module ui/RouterWaku
 *
 * **Waku layer only** for the one {@link ./Router} service — not a second Router
 * namespace. Install with {@link waku} / {@link layer.waku}; React adapters
 * ({@link Provider}, {@link Link}, {@link useRouter}) pull the optional `waku`
 * peer. Lite Memory / History / Outlet / `make` stay on `hyperlink-ts/ui/Router`.
 *
 * ```tsx
 * import * as Router from "hyperlink-ts/ui/Router"
 * import { waku, Provider, Link } from "hyperlink-ts/ui/Router/waku"
 *
 * const binding = waku(site) // or layer.waku(site)
 * <Provider value={binding}>
 *   <Link to={(u) => u.home()}>Home</Link>
 * </Provider>
 * ```
 *
 * Hooks require Waku's router in the tree (every Waku app has one).
 *
 * @see docs/handoffs/ui-routes-dream.md
 */
"use client";

import * as internal from "../internal/uiRouterWaku";
import type { ApiConstraint } from "../internal/uiRoutes";
import type * as Route from "./Route";

// =============================================================================
// Layer
// =============================================================================

export type { WakuBinding } from "../internal/uiRouterWaku";

/**
 * Waku layer input — provide with {@link Provider}.
 *
 * @public
 */
export const waku: typeof internal.waku = internal.waku;

/**
 * Waku layer only — Memory / History live on {@link ./Router.layer}.
 *
 * @public
 */
export const layer = {
  /**
   * Waku binding for {@link Provider}.
   *
   * @public
   */
  waku: <A extends ApiConstraint, U = Route.UrlBuilder<A>>(
    api: A,
    urls?: U,
  ): internal.WakuBinding<A, U> => internal.waku(api, urls),
} as const;

/** Optional default binding when no Provider is mounted (docs chrome). @public */
export const setDefault: typeof internal.setDefault = internal.setDefault;

/** @public */
export const isWakuBinding: typeof internal.isWakuBinding =
  internal.isWakuBinding;

// =============================================================================
// React adapters (Waku peer)
// =============================================================================

/**
 * One Provider: lite {@link ./Router.Service} **or** {@link waku} binding.
 *
 * @public
 */
export const Provider: typeof internal.Provider = internal.Provider;

/**
 * Live {@link ./Router.Service} from context or {@link setDefault}.
 *
 * @public
 */
export const useRouter: typeof internal.useRouter = internal.useRouter;

/** @public */
export const useHasRouter: typeof internal.useHasRouter =
  internal.useHasRouter;

/** @public */
export const useMatch: typeof internal.useMatch = internal.useMatch;

/**
 * Soft-nav link — Waku `Link` when the live service is `_tag: "Waku"`.
 *
 * @public
 */
export const Link: typeof internal.Link = internal.Link;

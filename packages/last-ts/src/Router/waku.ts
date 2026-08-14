/**
 * @module ui/RouterWaku
 *
 * **Waku layer only** for the one {@link ./Router} service — not a second Router
 * namespace. Prefer {@link ../Waku.layer} / {@link ../Waku.fromApi} provided via
 * {@link ../Last.provider}. The paramful {@link Provider} remains for escape
 * hatches.
 *
 * ```tsx
 * import * as Last from "last-ts/Last"
 * import * as Waku from "last-ts/Waku"
 *
 * export const provider = Last.provider(Waku.fromApi(site))
 * // <provider>…</provider>
 * ```
 *
 * Hooks require Waku's router in the tree (every Waku app has one).
 *
 * @see docs/handoffs/ui-routes-dream.md
 */
"use client";

import * as internal from "../internal/routerWaku";
import type { ApiConstraint } from "../internal/routes";
import type * as Route from "../Route";

// =============================================================================
// Layer
// =============================================================================

export type { WakuBinding } from "../internal/routerWaku";

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

/** Optional default binding when no Provider is mounted (docs UI). @public */
export const setDefault: typeof internal.setDefault = internal.setDefault;

/** @public */
export const isWakuBinding: typeof internal.isWakuBinding =
  internal.isWakuBinding;

// =============================================================================
// React adapters (Waku peer)
// =============================================================================

/**
 * One Provider: lite {@link ./Router.Service} **or** {@link waku} binding.
 * Prefer {@link ../Last.provider} + {@link ../Waku.fromApi} so call sites take
 * children only.
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

/**
 * @module ui/RouterWaku
 *
 * **Waku layer only** for the one {@link ./Router} service — not a second Router
 * namespace. Prefer {@link ../Waku.layer} / {@link ../Waku.fromApi} baked with
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

import * as React from "react";
import { Function as Fn } from "effect";
import type * as Last from "../Last";
import * as appInternal from "../internal/app";
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

/** Optional default binding when no Provider is mounted (docs chrome). @public */
export const setDefault: typeof internal.setDefault = internal.setDefault;

/** @public */
export const isWakuBinding: typeof internal.isWakuBinding =
  internal.isWakuBinding;

/**
 * @deprecated Prefer {@link ../Waku.layer} / {@link ../Waku.fromApi} with
 * {@link ../Last.provider}.
 *
 * @public
 */
export const router: {
  (
    binding: internal.WakuBinding<ApiConstraint, unknown>,
  ): (self: Last.App) => Last.App;
  (
    self: Last.App,
    binding: internal.WakuBinding<ApiConstraint, unknown>,
  ): Last.App;
} = Fn.dual(
  2,
  (
    self: Last.App,
    binding: internal.WakuBinding<ApiConstraint, unknown>,
  ): Last.App =>
    appInternal.withRouterInstall(self, (children) =>
      React.createElement(internal.Provider, { value: binding, children }),
    ),
);

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

/**
 * Soft-nav link — prefer {@link link}`(YourCatalog)` beside the router.
 * Deprecated free generic kept for migration; Waku push when `_tag: "Waku"`.
 *
 * @public
 */
export const Link: typeof internal.Link = internal.Link;

/**
 * Derive a typesafe Link from a catalog (same module as the router).
 *
 * @public
 */
export const link: typeof internal.link = internal.link;

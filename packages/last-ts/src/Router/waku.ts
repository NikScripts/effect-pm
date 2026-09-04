/**
 * @module ui/RouterWaku
 *
 * Binding helpers for {@link ../Waku}. Prefer
 * `Last.provider(Waku.fromApi|layer)` — no nested Provider / setDefault.
 *
 * @see docs/handoffs/ui-routes-dream.md
 */
"use client";

import * as internal from "../internal/routerWaku";

export type { WakuBinding } from "../internal/routerWaku";

/** Catalog binding (urls + api). Prefer {@link ../Waku.fromApi} at the edge. @public */
export const waku: typeof internal.waku = internal.waku;

/** @public */
export const isWakuBinding: typeof internal.isWakuBinding =
  internal.isWakuBinding;

/** Live {@link ./Router.Service} under {@link ../Last.provider}. @public */
export const useRouter: typeof internal.useRouter = internal.useRouter;

/** @public */
export const useHasRouter: typeof internal.useHasRouter =
  internal.useHasRouter;

/** @public */
export const useMatch: typeof internal.useMatch = internal.useMatch;

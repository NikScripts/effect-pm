/**
 * @module Waku
 *
 * Waku **location Layer** — own namespace because of the `waku` peer
 * (`History` / `Memory` stay on lite modules). Soft-nav is still
 * {@link ./Router.link}`(catalog)` — this module only swaps the engine.
 *
 * ```ts
 * // SPA / Outlet — RouterBuilder registry + Waku engine
 * export const provider = Last.provider(
 *   Waku.layer.pipe(Layer.provide(routes)),
 * )
 *
 * // RSC file routes — catalog soft-nav only (no Outlet handlers)
 * export const provider = Last.provider(Waku.fromApi(Site))
 * // <provider>…</provider>
 *
 * // Same module as the catalog:
 * export const Link = Router.link(Site)
 * ```
 *
 * Lower-level binding helpers re-export from the former `Router/waku` entry.
 *
 * @public
 */
"use client";

export {
  waku,
  layer as binding,
  setDefault,
  isWakuBinding,
  router,
  Provider,
  useRouter,
  useHasRouter,
  useMatch,
  type WakuBinding,
} from "./Router/waku";

import * as React from "react";
import { Effect, Layer } from "effect";
import * as appInternal from "./internal/app";
import * as Router from "./Router";
import * as routerBuilder from "./internal/routerBuilder";
import type { ApiConstraint } from "./internal/routes";
import * as wakuInternal from "./internal/routerWaku";
import type * as Route from "./Route";

// Live Waku mount for Last.provider (Layer build only holds a catalog stub).
appInternal.registerRouterMount("Waku", (service, children) =>
  React.createElement(wakuInternal.Provider, {
    value: wakuInternal.waku(service.api, service.urls),
    children,
  }),
);

const stubService = <A extends ApiConstraint, U = Route.UrlBuilder<A>>(
  api: A,
  options?: {
    readonly urls?: U;
    readonly registry?: Router.Service["_handlers"];
  },
): Router.Service => {
  const binding = wakuInternal.waku(api, options?.urls);
  return {
    api,
    _tag: "Waku" as const,
    pathname: "/",
    search: "",
    href: "/",
    match: undefined,
    urls: binding.urls,
    go: () => undefined,
    to: () => undefined,
    back: () => undefined,
    toRoot: () => undefined,
    prefetch: () => undefined,
    subscribe: () => () => undefined,
    syncFromLocation: () => undefined,
    ...(options?.registry !== undefined
      ? { _handlers: options.registry }
      : {}),
  } as Router.Service;
};

/**
 * Waku engine Layer — requires catalog + registry; adapts Waku’s client router.
 * Must render under Waku’s router tree.
 *
 * @example
 * ```ts
 * export const provider = Last.provider(
 *   Waku.layer.pipe(Layer.provide(routes)),
 * )
 * ```
 *
 * @public
 */
export const layer: Layer.Layer<
  Router.Router,
  never,
  routerBuilder.Catalog | routerBuilder.Registry
> = Layer.effect(
  Router.Router,
  Effect.gen(function* () {
    const api = yield* routerBuilder.Catalog;
    const registry = yield* routerBuilder.Registry;
    return stubService(api, { registry });
  }),
);

/**
 * Catalog-only Waku Layer — soft-nav urls without Outlet / RouterBuilder
 * handlers (RSC file routes own render).
 *
 * @example
 * ```ts
 * export const provider = Last.provider(Waku.fromApi(Site))
 * ```
 *
 * @public
 */
export const fromApi = <A extends ApiConstraint, U = Route.UrlBuilder<A>>(
  api: A,
  urls?: U,
): Layer.Layer<Router.Router> =>
  Layer.sync(Router.Router, () => stubService(api, { urls }));

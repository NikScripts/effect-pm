/**
 * @module History
 *
 * Browser History location transport for {@link ./Router}
 * (`pushState` / `popstate`).
 *
 * ```ts
 * // SPA / Outlet — RouterBuilder registry + History engine
 * export const provider = Last.provider(
 *   History.layer.pipe(Layer.provide(routes)),
 * )
 *
 * // Catalog soft-nav only (no Outlet handlers) — web dashboards
 * export const provider = Last.provider(History.fromApi(Site))
 * ```
 *
 * @public
 */
import { Effect, Layer } from "effect";
import * as Router from "./Router";
import * as routerBuilder from "./internal/routerBuilder";
import type { ApiConstraint } from "./internal/routes";
import * as internal from "./internal/router";

/**
 * History engine Layer — requires catalog + registry from {@link ./RouterBuilder}.
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
    const service = internal.makeService(api, "History");
    // Assign — do not `{ ...service }` (that snapshots live pathname getters).
    return Object.assign(service, {
      /** @internal builder registry for Outlet */
      _handlers: registry,
    }) as Router.Service;
  }),
);

/**
 * Live catalog-only History service (tests / sync install). Prefer
 * {@link fromApi} under {@link ./Last.provider}.
 *
 * @public
 */
export const service = <A extends ApiConstraint>(
  api: A,
): Router.Service<A> => internal.makeService(api, "History");

/**
 * Catalog-only History Layer — soft-nav / `Route.handle` Outlet without
 * {@link ./RouterBuilder} handlers (web dashboards, embeds).
 *
 * @example
 * ```ts
 * export const provider = Last.provider(History.fromApi(Site))
 * ```
 *
 * @public
 */
export const fromApi = <A extends ApiConstraint>(
  api: A,
): Layer.Layer<Router.Router> =>
  Layer.sync(Router.Router, () => service(api));

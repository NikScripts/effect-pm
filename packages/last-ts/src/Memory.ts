/**
 * @module Memory
 *
 * In-memory location transport for {@link ./Router} — no `window.history`.
 *
 * ```ts
 * // SPA / Outlet — RouterBuilder registry + Memory engine
 * export const provider = Last.provider(
 *   Memory.layer.pipe(Layer.provide(routes)),
 * )
 *
 * // Catalog soft-nav only (no Outlet handlers) — dashboards / tests
 * export const provider = Last.provider(Memory.fromApi(Site))
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
 * Memory engine Layer — requires catalog + registry from {@link ./RouterBuilder}.
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
    const service = internal.makeService(api, "Memory");
    // Assign — do not `{ ...service }` (that snapshots live pathname getters).
    return Object.assign(service, {
      /** @internal builder registry for Outlet */
      _handlers: registry,
    });
  }),
);

/**
 * Live catalog-only Memory service (tests / sync install). Prefer
 * {@link fromApi} under {@link ./Last.provider}.
 *
 * @public
 */
export const service = <A extends ApiConstraint>(
  api: A,
): Router.Service<A> => internal.makeService(api, "Memory");

/**
 * Catalog-only Memory Layer — soft-nav / `Route.handle` Outlet without
 * {@link ./RouterBuilder} handlers (dashboards, embeds, tests).
 *
 * @example
 * ```ts
 * export const provider = Last.provider(Memory.fromApi(Site))
 * ```
 *
 * @public
 */
export const fromApi = <A extends ApiConstraint>(
  api: A,
): Layer.Layer<Router.Router> =>
  Layer.sync(Router.Router, () => service(api));

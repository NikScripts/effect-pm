/**
 * @module Memory
 *
 * In-memory location transport for {@link ./Router} — no `window.history`.
 * Provides {@link ./Router.Router} from {@link ./RouterBuilder.Catalog} +
 * {@link ./RouterBuilder.Handlers}.
 *
 * ```ts
 * const routes = RouterBuilder.layer(Site).pipe(
 *   Layer.provide(Layer.mergeAll(marketing, docs)),
 * )
 * export const provider = Last.provider(
 *   Memory.layer.pipe(Layer.provide(routes)),
 * )
 * ```
 *
 * @public
 */
import { Effect, Layer } from "effect";
import * as Router from "./Router";
import * as routerBuilder from "./internal/routerBuilder";
import * as internal from "./internal/router";

/**
 * Memory engine Layer — requires catalog + handlers from {@link ./RouterBuilder}.
 *
 * @public
 */
export const layer: Layer.Layer<
  Router.Router,
  never,
  routerBuilder.Catalog | routerBuilder.Handlers
> = Layer.effect(
  Router.Router,
  Effect.gen(function* () {
    const api = yield* routerBuilder.Catalog;
    const handlers = yield* routerBuilder.Handlers;
    const service = internal.makeService(api, "Memory");
    return {
      ...service,
      /** @internal builder handlers for Outlet */
      _handlers: handlers,
    } as Router.Service;
  }),
);

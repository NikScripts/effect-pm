/**
 * @module History
 *
 * Browser History location transport for {@link ./Router}
 * (`pushState` / `popstate`). Provides {@link ./Router.Router} from
 * {@link ./RouterBuilder.Catalog} + {@link ./RouterBuilder.Registry}.
 *
 * ```ts
 * export const provider = Last.provider(
 *   History.layer.pipe(Layer.provide(routes)),
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

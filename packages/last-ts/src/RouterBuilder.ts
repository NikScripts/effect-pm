/**
 * @module RouterBuilder
 *
 * Build handler + layout Layers for a {@link ./Router} catalog
 * (`HttpApiBuilder` analogue).
 *
 * ```ts
 * const marketing = RouterBuilder.group(
 *   Site,
 *   "marketing",
 *   RootLayout,
 *   (h) => h.handle("home", Home).handle("pricing", Pricing),
 * )
 *
 * const routes = RouterBuilder.layer(Site).pipe(
 *   Layer.provide(Layer.mergeAll(marketing, docs)),
 * )
 * ```
 *
 * @public
 */
import type { Layout } from "./Layout";
import * as internal from "./internal/routerBuilder";

export type { HandleOptions, HandlersBuilder } from "./internal/routerBuilder";

/** @public */
export const Handlers: typeof internal.Handlers = internal.Handlers;

/** @public */
export const Catalog: typeof internal.Catalog = internal.Catalog;

/**
 * Implement one group — `(api, id, layout, handlers)`. Layout must accept
 * `children`. Use `.handle(id, Page, { layout: false })` to opt out.
 *
 * @public
 */
export const group: typeof internal.group = internal.group;

/**
 * Register the catalog; requires every top-level group Layer
 * (`HttpApiBuilder.layer`). Resolves `group.from(Service)` destinations, then
 * provides {@link Catalog} + {@link Handlers} for the resolved catalog.
 *
 * @public
 */
export const layer: typeof internal.layer = internal.layer;

/** @internal */
export const resolveRender: typeof internal.resolveRender =
  internal.resolveRender;

/** Re-export layout type for consumers. @public */
export type { Layout };

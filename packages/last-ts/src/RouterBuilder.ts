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
 *   (handlers) =>
 *     handlers.handle("home", Home).handle("pricing", Pricing),
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

export type { HandleOptions } from "./internal/routerBuilder";

/** Handler builder (`HttpApiBuilder.Handlers`). @public */
export type Handlers<
  EndpointsByIdentifier extends
    Record<string, import("./internal/route").Constraint> = {},
  HandledIdentifiers extends keyof EndpointsByIdentifier = never,
> = internal.Handlers<EndpointsByIdentifier, HandledIdentifiers>;

export declare namespace Handlers {
  export type FromGroup<G extends import("./internal/routes").GroupTop> =
    internal.Handlers.FromGroup<G>;
  export type ValidateReturn<A> = internal.Handlers.ValidateReturn<A>;
  export type Error<A> = internal.Handlers.Error<A>;
  export type Context<A> = internal.Handlers.Context<A>;
}

/** @deprecated Use {@link Handlers} */
export type HandlersBuilder<
  Endpoints extends Record<string, import("./internal/route").Constraint>,
  Handled extends keyof Endpoints = never,
> = internal.Handlers<Endpoints, Handled>;

/**
 * Resolved catalog + group implementations for transports / Outlet.
 *
 * @public
 */
export const Registry: typeof internal.Registry = internal.Registry;

/** @public */
export const Catalog: typeof internal.Catalog = internal.Catalog;

/**
 * Implement one group — `(api, id, layout, build)`. Layout must accept
 * `children`. Use `.handle(id, Page, { layout: false })` to opt out.
 *
 * Provides `Group.Service<ApiId, Identifier>` under `group.key`
 * (`HttpApiBuilder.group`).
 *
 * @public
 */
export const group: typeof internal.group = internal.group;

/**
 * Register the catalog; requires every group Layer (`HttpApiBuilder.layer`).
 * Resolves `group.from(Service)`, then provides {@link Catalog} + {@link Registry}.
 *
 * @public
 */
export const layer: typeof internal.layer = internal.layer;

/** @internal */
export const resolveRender: typeof internal.resolveRender =
  internal.resolveRender;

/** Re-export layout type for consumers. @public */
export type { Layout };

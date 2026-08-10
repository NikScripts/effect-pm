/**
 * @module RouterBuilder
 *
 * Build handler Layers for a {@link ./Router} catalog
 * (`HttpApiBuilder` analogue).
 *
 * ```ts
 * const marketing = pipe(
 *   RouterBuilder.group(Site, "marketing", (handlers) =>
 *     handlers.handle("home", Home).handle("pricing", Pricing),
 *   ),
 *   Layout.provide(AppShell),
 * )
 *
 * const routes = pipe(
 *   RouterBuilder.layer(Site),
 *   Layer.provide(Layer.mergeAll(marketing, docs)),
 * )
 * ```
 *
 * Page groups leave {@link ./Layout.Slot} in `R` — fulfill with
 * `Layout.provide`. See `docs/handoffs/page-layout-lock.md`.
 *
 * @public
 */
import type { Layout } from "./Layout";
import * as internal from "./internal/routerBuilder";

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

/**
 * Typed page props from a catalog path (same as {@link ./Router.PageProps}).
 *
 * @example
 * ```ts
 * type ChapterProps = RouterBuilder.PageProps<typeof Site, "docs", "chapter">
 * const Chapter = (props: ChapterProps) => <h1>{props.params.chapter}</h1>
 * ```
 *
 * @public
 */
export type PageProps<
  Api extends {
    readonly groups: Record<
      string,
      { readonly routes: Record<string, unknown> }
    >;
  },
  GroupId extends keyof Api["groups"] & string,
  EndpointId extends keyof Api["groups"][GroupId]["routes"] & string,
> = import("./internal/pageSuccess").PageProps<Api, GroupId, EndpointId>;

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
 * Implement one group — `(api, id, build)` (HttpApi-shaped). Page groups leave
 * {@link ./Layout.Slot} in `R`; fulfill with `pipe(group, Layout.provide(…))`.
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
export const resolveHandler: typeof internal.resolveHandler =
  internal.resolveHandler;

/** @deprecated Use {@link resolveHandler}. @internal */
export const resolveRender: typeof internal.resolveRender =
  internal.resolveRender;

/** Re-export layout type for consumers. @public */
export type { Layout };

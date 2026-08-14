/**
 * @module Last
 *
 * Cross-cutting Last.ts: factory brands, {@link provide} (entry-point fulfill),
 * {@link provider}, {@link context} / {@link use}, and {@link link}.
 *
 * ```ts
 * export class Site extends Last.context({ NavBar: NavBar.NavBarContext }) {}
 * // Track 1: Last.provider(layer, Site)
 * // Track 2: catalog .context(Site) + Last.provideContext(siteLayer); Last.use(App)
 * const DocsLink = Last.link(SiteCatalog, { to: (u) => u.docs })
 * const HelloView = Last.provide(Hello) // Service Layer → value (ViewFn, …)
 * ```
 *
 * SSOT: `docs/handoffs/last-context-view-lock.md` · Effect Style → provide at entry points.
 */

import { Context, Effect, Layer } from "effect";
import * as appInternal from "./internal/app";
import * as lastContext from "./internal/lastContext";
import * as lastLink from "./internal/lastLink";

// =============================================================================
// Provider (Layer → children-only React component) — page entry point
// =============================================================================

/**
 * Build a children-only React provider from a fulfilled Layer and/or a {@link context}.
 * Web-page / app entry-point provide (Effect Style → provide at entry points).
 *
 * @public
 */
export const provider: typeof appInternal.provider = appInternal.provider;

// =============================================================================
// Last.context / Last.use / provideContext
// =============================================================================

/**
 * Mint a context class: `class Site extends Last.context({ … }) {}`.
 *
 * @public
 */
export const context: typeof lastContext.context = lastContext.context;

/**
 * Read a context bag under {@link provider}, or a router-scoped bag:
 * `Last.use(App)`, `Last.use(App, "docs")`, `Last.use(App, (r) => r.docs)`.
 *
 * @public
 */
export const use: typeof lastContext.use = lastContext.use;

/**
 * Layer / runtime service requirements for a {@link context} class.
 *
 * @public
 */
export type ServicesOf<C> = lastContext.ServicesOf<C>;

/**
 * Discharge router `.context` Layer requirements (dual of {@link ./Layout.provide}).
 *
 * @public
 */
export const provideContext: typeof lastContext.provideContext =
  lastContext.provideContext;

/**
 * Wrap a component (or children) with soft-nav ({@link ./Router.UnboundLink}).
 * Prefer {@link ./Router.link}`(YourCatalog)` beside the router for typed `to`.
 *
 * @public
 */
export const link: typeof lastLink.link = lastLink.link;

// =============================================================================
// Factory brand
// =============================================================================

/**
 * Where a handle’s **factory brand** is stowed (e.g. `last-ts/View`).
 *
 * @internal
 */
export const kindSym: unique symbol = Symbol.for("last-ts/Last/kind");

/**
 * The factory brand a handle was minted for (e.g. `last-ts/View`).
 *
 * @category introspection
 * @public
 */
export const kindOf = (tag: unknown): string | undefined => {
  if (
    (typeof tag === "object" || typeof tag === "function") &&
    tag !== null &&
    kindSym in tag
  ) {
    const value = (tag as { readonly [kindSym]: unknown })[kindSym];
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
};

// =============================================================================
// Last.provide — entry-point fulfill (Effect / Service + requirements → A)
// =============================================================================

type ServiceWithLayer = {
  readonly layer: Layer.Layer<any, any, any>;
  readonly key?: string;
};

type ServiceValueOf<S> = S extends Context.Key<infer _I, infer A> ? A
  : S extends { readonly Type: infer A } ? A
  : unknown;

const isServiceWithLayer = (u: unknown): u is ServiceWithLayer =>
  (typeof u === "object" || typeof u === "function") &&
  u !== null &&
  "layer" in u &&
  Layer.isLayer((u as ServiceWithLayer).layer);

const buildService = <S extends ServiceWithLayer>(
  service: S,
  requirements?: Layer.Layer<any, any, never>,
): ServiceValueOf<S> => {
  const layer =
    requirements !== undefined
      ? Layer.provide(service.layer, requirements)
      : service.layer;
  const ctx = Effect.runSync(
    Effect.scoped(Layer.build(layer as Layer.Layer<any, any, never>)),
  );
  return Context.get(
    ctx,
    service as unknown as Context.Key<unknown, ServiceValueOf<S>>,
  );
};

const runEffect = <A, E, R>(
  program: Effect.Effect<A, E, R>,
  requirements?: Layer.Layer<R, any, never>,
): A => {
  const effect =
    requirements !== undefined
      ? Effect.provide(program, requirements)
      : (program as Effect.Effect<A, E, never>);
  return Effect.runSync(effect as Effect.Effect<A, E, never>);
};

/**
 * Entry-point fulfill: discharge `R` and return the value.
 *
 * - {@link provide}`(Service)` — build `Service.layer` (`R` must be `never`)
 * - {@link provide}`(Service, requirements)` — `Layer.provide` then build
 * - {@link provide}`(effect)` — run when `R` is `never`
 * - {@link provide}`(effect, requirements)` — `Effect.provide` then run
 *
 * Same seam as Effect Style → provide at entry points. Does **not** open
 * {@link provider} (React page bake). For a View service, `A` is the render fn.
 *
 * @example
 * ```ts
 * const App = Last.provide(Hello)
 * const App = Last.provide(Open, Greeter.layer)
 * const n = Last.provide(Effect.succeed(1))
 * ```
 *
 * @public
 */
export const provide: {
  <S extends { readonly layer: Layer.Layer<any, any, never> }>(
    service: S,
  ): ServiceValueOf<S>;
  <S extends { readonly layer: Layer.Layer<any, any, any> }, R, E = never>(
    service: S & { readonly layer: Layer.Layer<any, any, R> },
    requirements: Layer.Layer<R, E, never>,
  ): ServiceValueOf<S>;
  <A, E>(
    effect: Effect.Effect<A, E, never> & { readonly layer?: never },
  ): A;
  <A, E, R, E2 = never>(
    effect: Effect.Effect<A, E, R> & { readonly layer?: never },
    requirements: Layer.Layer<R, E2, never>,
  ): A;
} = ((
  first: ServiceWithLayer | Effect.Effect<any, any, any>,
  requirements?: Layer.Layer<any, any, never>,
) => {
  if (isServiceWithLayer(first)) {
    return buildService(first, requirements);
  }
  return runEffect(
    first as Effect.Effect<any, any, any>,
    requirements,
  );
}) as typeof provide;

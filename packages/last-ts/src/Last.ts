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
 * // Services are Effects — same seam as Effect.provide + run
 * const HelloView = Last.provide(Hello, helloLayer)
 * ```
 *
 * SSOT: `docs/handoffs/last-context-view-lock.md` · Effect Style → provide at entry points.
 */

import { Effect, Layer } from "effect";
import * as appInternal from "./internal/app";
import { kindSym } from "./internal/kindSym";
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
 * Wrap a component (or children) with soft-nav ({@link ./Link.View} +
 * {@link ./Link.To} / {@link ./Link.Out}). Prefer {@link ./Router.link}`(YourCatalog)`
 * beside the router for typed `to`. Optional Layer overrides handlers / View.
 *
 * @public
 */
export const link: typeof lastLink.link = lastLink.link;

// =============================================================================
// Factory brand
// =============================================================================

/**
 * Where a handle’s **factory brand** is stowed (e.g. `last-ts/View`).
 * Defined in `internal/kindSym` so `View` can stamp without importing this
 * module (breaks View → Last → … → Link → View TDZ).
 *
 * @internal
 */
export { kindSym };

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
// Last.provide — entry-point Effect.provide + run (Services are Effects)
// =============================================================================

/**
 * Entry-point fulfill: {@link Effect.provide} then `runSync`.
 *
 * Services are Effects — pass the tag and the Layer that installs it
 * (a const Layer, composed with `Layer.provide` when `R` is open — not
 * `static layer` on the class). Does **not** open {@link provider} (React page bake).
 *
 * @example
 * ```ts
 * const App = Last.provide(Hello, helloLayer)
 * const App = Last.provide(Open, Layer.provide(openLayer, greeterLayer))
 * const n = Last.provide(Effect.succeed(1))
 * ```
 *
 * @public
 */
export const provide: {
  <A, E>(effect: Effect.Effect<A, E, never>): A;
  <A, E, R, E2 = never>(
    effect: Effect.Effect<A, E, R>,
    requirements: Layer.Layer<R, E2, never>,
  ): A;
} = ((
  effect: Effect.Effect<any, any, any>,
  requirements?: Layer.Layer<any, any, never>,
) => {
  const fulfilled =
    requirements === undefined
      ? (effect as Effect.Effect<any, any, never>)
      : Effect.provide(effect, requirements);
  return Effect.runSync(fulfilled);
}) as typeof provide;

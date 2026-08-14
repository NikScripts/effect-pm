/**
 * @module Last
 *
 * Cross-cutting Last.ts: factory brands, upward **Provides**,
 * {@link provider}, {@link context} / {@link use}, and {@link link}.
 *
 * ```ts
 * export class Site extends Last.context({ NavBar: NavBar.NavBarContext }) {}
 * // Track 1: Last.provider(layer, Site)
 * // Track 2: catalog .context(Site) + Last.provideContext(siteLayer); Last.use(App)
 * const DocsLink = Last.link(SiteCatalog, { to: (u) => u.docs })
 * ```
 *
 * SSOT: `docs/handoffs/last-context-view-lock.md`.
 */

import { Context, Effect, Layer } from "effect";
import * as appInternal from "./internal/app";
import * as lastContext from "./internal/lastContext";
import * as lastLink from "./internal/lastLink";

// =============================================================================
// Provider shell (Layer → children-only React component)
// =============================================================================

export type App = appInternal.App;

/**
 * Bake a fulfilled Layer and/or a {@link context} into a children-only React provider.
 *
 * @public
 */
export const provider: typeof appInternal.provider = appInternal.provider;

// =============================================================================
// Last.context / Last.use
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
 * Layer / runtime service debt for a {@link context} class.
 *
 * @public
 */
export type ServicesOf<C> = lastContext.ServicesOf<C>;

/**
 * Discharge router `.context` Layer debt (dual of {@link ./Layout.provide}).
 *
 * @example
 * ```ts
 * pipe(RouterBuilder.group(App, "docs", …), Layout.provide(DocsLayout), Last.provideContext(docsKitLayer))
 * ```
 *
 * @public
 */
export const provideContext: typeof lastContext.provideContext =
  lastContext.provideContext;

/**
 * Wrap a component (or children) with soft-nav ({@link ./Router.UnboundLink}).
 * Prefer {@link ./Router.link}`(YourCatalog)` beside the router for typed `to`.
 * Returns a plain / effect component — not a View tag.
 *
 * @public
 */
export const link: typeof lastLink.link = lastLink.link;

/**
 * @deprecated Prefer {@link provider}.
 * @public
 */
export const app: typeof appInternal.app = appInternal.app;

/**
 * @deprecated Prefer {@link ./History.layer} / {@link ./Memory.layer} in the Layer graph.
 * @public
 */
export const router: typeof appInternal.router = appInternal.router;

/**
 * @deprecated Prefer {@link provider}.
 * @public
 */
export const withRouterInstall: typeof appInternal.withRouterInstall =
  appInternal.withRouterInstall;

/**
 * @deprecated Prefer {@link provider}.
 * @public
 */
export const toProvider: typeof appInternal.toProvider =
  appInternal.toProvider;

// =============================================================================
// Factory brand (existing)
// =============================================================================

/**
 * Where a handle’s **factory brand** is stowed (e.g. `last-ts/View`).
 * Set by each module’s Tag mint; read with {@link kindOf}.
 *
 * @internal
 */
export const kindSym: unique symbol = Symbol.for("last-ts/Last/kind");

/**
 * The factory brand a handle was minted for (e.g. `last-ts/View`).
 * `undefined` when `tag` was not stamped by Last.
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
// Upward Provides → Context.Service Layer
// =============================================================================

/** Flatten `&` nests for readable hovers. @internal */
type Flat<T extends object> = { readonly [K in keyof T]: T[K] } & {};

/**
 * Last-wins object merge (`B` overwrites `A` on shared keys).
 *
 * @public
 */
export type MergeLast<A extends object, B extends object> = Flat<
  Omit<A, keyof B> & B
>;

/**
 * Required keys of `S` (optional props excluded).
 *
 * @public
 */
export type RequiredKeys<S extends object> = {
  [K in keyof S]-?: undefined extends S[K] ? never : K;
}[keyof S];

/**
 * Keys still required before {@link toLayer} can succeed.
 *
 * @public
 */
export type MissingKeys<S extends object, P extends object> = Exclude<
  RequiredKeys<S>,
  keyof P
>;

/**
 * Whether `P` covers every required key of `S` with an assignable value.
 *
 * @public
 */
export type IsComplete<S extends object, P extends object> =
  [MissingKeys<S, P>] extends [never]
    ? [RequiredKeys<S>] extends [never]
      ? true
      : {
          [K in RequiredKeys<S>]: K extends keyof P
            ? [P[K]] extends [S[K]]
              ? true
              : false
            : false;
        }[RequiredKeys<S>] extends true
        ? true
        : false
    : false;

/**
 * Success value of {@link provide} — generators collect these into Provides.
 *
 * @public
 */
export interface ProvideToken<I, S extends object, P extends object = {}> {
  readonly _tag: "Last/ProvideToken";
  readonly service: Context.Service<I, S>;
  readonly bag: P;
}

/**
 * {@link Layer} when `P` covers required keys of `S`; otherwise a diagnostic
 * object type (not a Layer).
 *
 * @public
 */
export type ToLayer<I, S extends object, P extends object> =
  IsComplete<S, P> extends true
    ? Layer.Layer<I>
    : {
        readonly _error: "Last.toLayer: incomplete provide";
        readonly missing: MissingKeys<S, P>;
      };

/**
 * Bag contributed toward `S` by a Provides union of {@link ProvideToken}s.
 *
 * @public
 */
export type BagForService<Provides, I, S extends object> = [
  Extract<Provides, ProvideToken<I, S, any>>,
] extends [never]
  ? {}
  : Extract<Provides, ProvideToken<I, S, any>> extends ProvideToken<
        I,
        S,
        infer P
      >
    ? P
    : {};

/**
 * {@link toLayer} result from Provides tokens.
 *
 * @public
 */
export type ToLayerFromProvides<
  I,
  S extends object,
  Provides,
> = ToLayer<I, S, BagForService<Provides, I, S>>;

/** Tokens yielded from a generator’s `Eff` channel. @internal */
type ProvideTokensOf<Eff> = Extract<
  Effect.Success<Eff>,
  ProvideToken<any, any, any>
>;

/** @internal */
export const provideLedgerSym: unique symbol = Symbol.for(
  "last-ts/Last/provideLedger",
);

/** @internal */
export type ProvideLedger = Map<
  string,
  { readonly service: Context.Service<any, any>; bag: object }
>;

let activeLedger: ProvideLedger | undefined;

/** @internal */
export const withProvideLedger = <A>(
  ledger: ProvideLedger,
  body: () => A,
): A => {
  const prev = activeLedger;
  activeLedger = ledger;
  try {
    return body();
  } finally {
    activeLedger = prev;
  }
};

/** @internal */
export const runProvideCollect = (
  create: Effect.Effect<unknown, unknown, never>,
): ProvideLedger => {
  const ledger: ProvideLedger = new Map();
  withProvideLedger(ledger, () => {
    Effect.runSync(Effect.asVoid(create as Effect.Effect<unknown, never, never>));
  });
  return ledger;
};

/**
 * Contribute a **partial** bag toward a {@link Context.Service}.
 * Use inside `Effect.gen`: `yield* Last.provide(ShellMeta, { title })`.
 * Last write wins per service. Types flow via {@link ProvideToken}.
 *
 * @public
 */
export const provide = <I, S extends object, const P extends Partial<S>>(
  service: Context.Service<I, S>,
  bag: P,
): Effect.Effect<ProvideToken<I, S, P>> =>
  Effect.sync(() => {
    if (activeLedger !== undefined) {
      const prev = activeLedger.get(service.key);
      activeLedger.set(service.key, {
        service,
        bag: { ...(prev?.bag ?? {}), ...bag },
      });
    }
    return {
      _tag: "Last/ProvideToken" as const,
      service,
      bag,
    };
  });

/**
 * Build `Layer.succeed(service, bag)` from an `Effect.gen` body that
 * {@link provide}d enough keys. Pass the **generator** (not `Effect.gen`) so
 * Provides infer from yielded tokens. Incomplete ⇒ non-Layer diagnostic type.
 *
 * @example
 * ```ts
 * function* helloProvides() {
 *   yield* Last.provide(ShellMeta, { title: "uDumb" })
 * }
 * const meta = Last.toLayer(ShellMeta, helloProvides)
 * ```
 *
 * @public
 */
export const toLayer = <
  I,
  S extends object,
  Eff extends Effect.Effect<any, any, any>,
>(
  service: Context.Service<I, S>,
  f: () => Generator<Eff, any, never>,
): ToLayerFromProvides<I, S, ProvideTokensOf<Eff>> => {
  const ledger = runProvideCollect(
    Effect.asVoid(Effect.gen(f)) as Effect.Effect<unknown, unknown, never>,
  );
  const entry = ledger.get(service.key);
  return Layer.succeed(
    service,
    (entry?.bag ?? {}) as S,
  ) as ToLayerFromProvides<I, S, ProvideTokensOf<Eff>>;
};

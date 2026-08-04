/**
 * @module Last
 *
 * Cross-cutting Last.ts: factory brands + upward value **Provides** toward
 * normal {@link Context.Service} bags (not View.Service handles).
 *
 * ```ts
 * yield* Last.provide(ShellMeta, { title: "uDumb" }) // partial OK; last wins
 * const layer = Last.toLayer(ShellMeta, Hello)       // only if Hello covered it
 * View.mount(Page, layer)
 * ```
 */

import { Context, Effect, Layer } from "effect";

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
 * Success value of {@link provide} — View.gen collects these into Provides.
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
 * {@link toLayer} result from a View’s Provides.
 *
 * @public
 */
export type ToLayerFromProvides<
  I,
  S extends object,
  Provides,
> = ToLayer<I, S, BagForService<Provides, I, S>>;

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
 * Use inside `View.gen` / `Effect.gen`: `yield* Last.provide(ShellMeta, { title })`.
 * Last write wins per service. Types flow via {@link ProvideToken} → View Provides.
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
 * Build `Layer.succeed(service, bag)` from a View that {@link provide}d enough
 * keys. Incomplete Provides ⇒ non-Layer diagnostic type.
 *
 * @example
 * ```ts
 * const Hello = View.gen(function* () {
 *   yield* Last.provide(ShellMeta, { title: "uDumb" })
 *   return () => <p />
 * })
 * View.mount(Page, Last.toLayer(ShellMeta, Hello))
 * ```
 *
 * @public
 */
export const toLayer = <
  I,
  S extends object,
  V extends {
    readonly "~last-ts/View/provides"?: unknown;
    readonly [provideLedgerSym]?: ProvideLedger;
  },
>(
  service: Context.Service<I, S>,
  view: V,
): ToLayerFromProvides<
  I,
  S,
  V extends { readonly "~last-ts/View/provides": infer P } ? P : never
> => {
  const ledger = view[provideLedgerSym];
  const entry = ledger?.get(service.key);
  return Layer.succeed(
    service,
    (entry?.bag ?? {}) as S,
  ) as ToLayerFromProvides<
    I,
    S,
    V extends { readonly "~last-ts/View/provides": infer P } ? P : never
  >;
};

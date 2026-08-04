/**
 * @module Last
 *
 * Cross-cutting Last.ts: factory brands + upward value **Provides** toward
 * normal {@link Context.Service} bags (not View.Tag).
 *
 * Pattern: declare a Context service for the value bag → deep code
 * {@link provided} / {@link provide} partials (last write wins per service) →
 * {@link toLayer} only when required keys are covered → {@link View.mount}
 * like any other `R`.
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
 * Typed partial contribution toward a {@link Context.Service}.
 *
 * @public
 */
export interface Provided<I, S extends object, P extends object = {}> {
  readonly _tag: "Last/Provided";
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
 * Build a typed {@link Provided} ledger entry (partial OK).
 *
 * @example
 * ```ts
 * class ShellMeta extends Context.Service<ShellMeta, { readonly title: string }>()(
 *   "app/shell-meta",
 * ) {}
 * const p = Last.provided(ShellMeta, { title: "Hello" })
 * const layer = Last.toLayer(p) // Layer<ShellMeta>
 * ```
 *
 * @public
 */
export const provided = <I, S extends object, const P extends Partial<S>>(
  service: Context.Service<I, S>,
  bag: P,
): Provided<I, S, P> => ({
  _tag: "Last/Provided",
  service,
  bag,
});

/**
 * Merge another partial into a {@link Provided} (last write wins).
 *
 * @public
 */
export const merge = <
  I,
  S extends object,
  P1 extends object,
  const P2 extends Partial<S>,
>(
  prev: Provided<I, S, P1>,
  bag: P2,
): Provided<I, S, MergeLast<P1, P2>> => ({
  _tag: "Last/Provided",
  service: prev.service,
  bag: { ...prev.bag, ...bag } as MergeLast<P1, P2>,
});

/**
 * Effect form of {@link provided} — for `View.gen` / `Effect.gen`.
 * Returns the ledger value; does not yet auto-thread Provides onto View types.
 *
 * @public
 */
export const provide = <I, S extends object, const P extends Partial<S>>(
  service: Context.Service<I, S>,
  bag: P,
): Effect.Effect<Provided<I, S, P>> => Effect.succeed(provided(service, bag));

function toLayerImpl(
  serviceOrProvided: Context.Service<any, any> | Provided<any, any, any>,
  maybeBag?: object,
): Layer.Layer<any> {
  if (
    typeof serviceOrProvided === "object" &&
    serviceOrProvided !== null &&
    "_tag" in serviceOrProvided &&
    (serviceOrProvided as Provided<any, any, any>)._tag === "Last/Provided"
  ) {
    const self = serviceOrProvided as Provided<any, any, any>;
    return Layer.succeed(self.service, self.bag as never);
  }
  return Layer.succeed(
    serviceOrProvided as Context.Service<any, any>,
    maybeBag as never,
  );
}

/**
 * Turn a complete {@link Provided} into `Layer.succeed(service, bag)`.
 * Incomplete bags yield a non-Layer diagnostic type (compile error at use sites
 * that need `Layer.Layer<I>`).
 *
 * @public
 */
export const toLayer: {
  <I, S extends object, P extends object>(
    self: Provided<I, S, P>,
  ): ToLayer<I, S, P>;
  <I, S extends object, const P extends Partial<S>>(
    service: Context.Service<I, S>,
    bag: P,
  ): ToLayer<I, S, P>;
} = toLayerImpl as typeof toLayer;

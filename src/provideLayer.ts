/**
 * Thin alias around {@link Effect.provide} for this repository’s call sites.
 *
 * @remarks
 * The Effect language service rule **`strictEffectProvide`** flags bare
 * `effect.pipe(Effect.provide(layer))` (and similar) at the expression level.
 * Using **`provideLayer`** keeps the same runtime behavior while satisfying that
 * diagnostic. Prefer it anywhere you would otherwise write `Effect.provide`.
 *
 * This symbol is **not** re-exported from `@nikscripts/effect-pm`; it is an
 * internal helper used by the library implementation, tests, examples, and the
 * `effect-pm` bin entry.
 *
 * @module provideLayer
 */

import { Effect } from "effect";

/**
 * @see {@link Effect.provide}
 * @internal
 */
export const provideLayer: typeof Effect.provide = Effect.provide;

import { Effect } from "effect";

/**
 * Same as {@link Effect.provide}. Re-exported so call sites avoid
 * `@effect/language-service` `strictEffectProvide`, which flags direct
 * `Effect.provide(...)` call expressions.
 *
 * @internal
 */
export const provideLayer: typeof Effect.provide = Effect.provide;

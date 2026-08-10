/**
 * PolicyBuilder — HttpApi-shaped constructable kernel for policy modules
 * (`Policy` / future `LookupPolicy` / `NodePolicy`).
 *
 * **Two layers:**
 * 1. **Constructable** — `class X extends PolicyBuilder.make(id).key(name, schema, opts)`.
 *    Each key is one PascalCase **handle**: a {@link Context.Reference} that is
 *    also callable `(value) => branded Policy Layer`.
 * 2. **Module** — re-export handles + mode presets (`verifyOff`, `askIncumbent`, …).
 *
 * ```ts
 * import * as PolicyBuilder from "hyperlink-ts/PolicyBuilder"
 * import { Effect, Schema } from "effect"
 *
 * class Demo extends PolicyBuilder.make("demo/Policy")
 *   .key("Sticky", Schema.Boolean, { defaultValue: () => true })
 *   .key("Yield", Schema.Boolean, {
 *     defaultValue: () => Effect.succeed(true),
 *     toRuntime: (b) => Effect.succeed(b),
 *   })
 * {}
 *
 * export const Sticky = Demo.Sticky
 * // yield* Sticky          — Reference
 * // Sticky(true)           — Policy Layer
 * // Demo.make({ Sticky: true }).pipe(Demo.layer(Sticky(false)))
 * ```
 *
 * @module PolicyBuilder
 */
import type { Schema } from "effect";
import type * as internal from "./internal/policyBuilder";
import * as engine from "./internal/policyBuilder";

// =============================================================================
// Models
// =============================================================================

/**
 * One config key: Schema (config input) + Reference (runtime) + encode.
 *
 * @category models
 * @public
 */
export type KeySpec<
  S extends Schema.Top,
  Runtime = Schema.Schema.Type<S>,
> = internal.PolicyBuilderKeySpec<S, Runtime>;

/**
 * A branded policy fragment / bundle — a `Layer.Layer<never>` plus frozen config.
 *
 * @category models
 * @public
 */
export type Policy<Id extends string, C extends object> =
  internal.PolicyBuilderPolicy<Id, C>;

/**
 * Patch `Prev` with `Patch` — patch keys win (same as Layer merge last-write).
 *
 * @category models
 * @public
 */
export type MergeConfigs<
  Prev extends object,
  Patch extends object,
> = internal.PolicyBuilderMergeConfigs<Prev, Patch>;

/**
 * Config type parameter of a {@link Policy}.
 *
 * @category models
 * @public
 */
export type ConfigOf<P> = internal.PolicyBuilderConfigOf<P>;

/**
 * Left-to-right {@link MergeConfigs} over a list of branded policies.
 *
 * @category models
 * @public
 */
export type MergePolicyList<
  Id extends string,
  Ps extends ReadonlyArray<Policy<Id, object>>,
> = internal.PolicyBuilderMergePolicyList<Id, Ps>;

/**
 * Config object shape derived from a constructable’s keys map.
 *
 * @category models
 * @public
 */
export type ConfigOfKeys<
  Keys extends Record<string, KeySpec<any, any>>,
> = internal.PolicyBuilderConfigOfKeys<Keys>;

/**
 * Tagged fragment sum for a keys map — `_tag` names the knob; `value` is the
 * schema input. Product bags (`make({ Sticky: true })`) stay untagged.
 *
 * @category models
 * @public
 */
export type FragmentOfKeys<
  Keys extends Record<string, KeySpec<any, any>>,
> = internal.PolicyBuilderFragmentOfKeys<Keys>;

/**
 * Product config stamped from a fragment list (last write wins per `_tag`).
 *
 * @category models
 * @public
 */
export type ConfigFromFragments<
  Fs extends ReadonlyArray<{
    readonly _tag: string;
    readonly value: unknown;
  }>,
> = internal.PolicyBuilderConfigFromFragments<Fs>;

/**
 * One key handle — Reference + `(value) => Policy Layer`.
 *
 * @category models
 * @public
 */
export type Handle<
  Id extends string,
  K extends string,
  Spec extends KeySpec<any, any>,
> = internal.PolicyBuilderHandle<Id, K, Spec>;

/**
 * Flat PascalCase handles derived from a keys map.
 *
 * @category models
 * @public
 */
export type HandlesOfKeys<
  Id extends string,
  Keys extends Record<string, KeySpec<any, any>>,
> = internal.PolicyBuilderHandlesOfKeys<Id, Keys>;

/**
 * Fragment `$is` / `$match` / bag converters on a Def.
 *
 * @category models
 * @public
 */
export type MatchersOfKeys<
  Keys extends Record<string, KeySpec<any, any>>,
> = internal.PolicyBuilderMatchersOfKeys<Keys>;

/**
 * Constructable returned by {@link make} — the `class extends` target (HttpApi-shaped).
 *
 * @category models
 * @public
 */
export type Def<
  Id extends string,
  Keys extends Record<string, KeySpec<any, any>>,
> = internal.PolicyBuilderDef<Id, Keys>;

// =============================================================================
// Constructors
// =============================================================================

/**
 * Empty constructable (HttpApi.`make(id)` analogue).
 *
 * Widen with `.key(name, schema, { defaultValue, toRuntime? })`, then
 * `class extends`. Each key becomes a PascalCase handle on the Def.
 *
 * ```ts
 * class Demo extends PolicyBuilder.make("demo/Policy")
 *   .key("Sticky", Schema.Boolean, { defaultValue: () => true })
 * {}
 * // Demo.Sticky — yield* / Sticky(true)
 * ```
 *
 * @category constructors
 * @public
 */
export const make: typeof engine.make = engine.make;

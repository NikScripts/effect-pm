/**
 * PolicyBuilder — HttpApi-shaped constructable kernel for policy **modules**
 * (`LookupPolicy`, `NodePolicy`; today’s Eng’d `Policy` is the Lookup family).
 *
 * **Two layers:**
 * 1. **Constructable** (private name, e.g. `Keys`) —
 *    `class Keys extends PolicyBuilder.make(id).key(name, schema, opts)`.
 *    Each key is a PascalCase {@link Context.Reference} on the Def.
 * 2. **Module** (`import * as LookupPolicy`) — re-export References + recreate
 *    camelCase Layer helpers (`sticky`, `streamGap`, …) and mode presets.
 *    Constructable name ≠ module namespace.
 *
 * ```ts
 * import * as PolicyBuilder from "hyperlink-ts/PolicyBuilder"
 * import { Effect, Schema } from "effect"
 *
 * // private constructable — not the public module name
 * class Keys extends PolicyBuilder.make("hyperlink-ts/LookupPolicy")
 *   .key("Sticky", Schema.Boolean, { defaultValue: () => true })
 *   .key("Yield", Schema.Boolean, {
 *     defaultValue: () => Effect.succeed(true),
 *     toRuntime: (b) => Effect.succeed(b),
 *   })
 * {}
 *
 * export const Sticky = Keys.Sticky
 * export const sticky = Keys.succeed({ _tag: "Sticky", value: true })
 * export const make = Keys.make
 * ```
 *
 * Apps import the module (`LookupPolicy` / `NodePolicy`), not this builder.
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
 * Flat PascalCase Context.References derived from a keys map.
 *
 * @category models
 * @public
 */
export type RefsOfKeys<
  Keys extends Record<string, KeySpec<any, any>>,
> = internal.PolicyBuilderRefsOfKeys<Keys>;

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
 * `class Keys extends` (name the constructable something other than the public
 * module namespace). Each key becomes a PascalCase Reference on the Def.
 *
 * @category constructors
 * @public
 */
export const make: typeof engine.make = engine.make;

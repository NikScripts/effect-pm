/**
 * PolicyBuilder — HttpApi-shaped constructable kernel for policy families
 * (`Policy` / future `LookupPolicy` / `NodePolicy`).
 *
 * **Two layers:**
 * 1. **Family** — `make(id).key(name, schema, { defaultValue, toRuntime? })` then
 *    `class extends` (keys + value Schemas + derived Context.References).
 * 2. **Module** — recreate helpers on top (`sticky`, `streamGap`, re-export
 *    `Family.references.*`) — hand-written DX in most cases.
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
 * // module recreates helpers
 * export const Sticky = Demo.references.Sticky
 * export const sticky = Demo.succeed("Sticky", true)
 *
 * const bundle = Demo.make({ Sticky: true }).pipe(
 *   Demo.layer(Demo.succeed("Sticky", false)),
 * )
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
 * Left-to-right {@link MergeConfigs} over a list of policies in one family.
 *
 * @category models
 * @public
 */
export type MergePolicyList<
  Id extends string,
  Ps extends ReadonlyArray<Policy<Id, object>>,
> = internal.PolicyBuilderMergePolicyList<Id, Ps>;

/**
 * Config object shape derived from a family’s keys map.
 *
 * @category models
 * @public
 */
export type ConfigOfKeys<
  Keys extends Record<string, KeySpec<any, any>>,
> = internal.PolicyBuilderConfigOfKeys<Keys>;

/**
 * Constructable family returned by {@link make} — `class extends` target.
 *
 * @category models
 * @public
 */
export type Family<
  Id extends string,
  Keys extends Record<string, KeySpec<any, any>>,
> = internal.PolicyBuilderFamily<Id, Keys>;

// =============================================================================
// Constructors
// =============================================================================

/**
 * Empty policy family constructable (HttpApi.`make(id)` analogue).
 *
 * Widen with `.key(name, schema, { defaultValue, toRuntime? })`, then
 * `class extends`. Domain modules recreate helpers on top of the class.
 *
 * ```ts
 * class Demo extends PolicyBuilder.make("demo/Policy")
 *   .key("Sticky", Schema.Boolean, { defaultValue: () => true })
 * {}
 * ```
 *
 * @category constructors
 * @public
 */
export const make: typeof engine.make = engine.make;

/**
 * PolicyBuilder — HttpApi-shaped constructable kernel for policy families
 * (`Policy` / future `LookupPolicy` / `NodePolicy`).
 *
 * `make(id)` returns a **constructor** you `class extends`, then widen with
 * fluent {@link Family.key} / {@link Family.keyEncoded} (HttpApi.`add` style).
 * The class carries `make` / `layer` / `provide` / `succeed` for branded
 * Layer+config values.
 *
 * ```ts
 * import * as PolicyBuilder from "hyperlink-ts/PolicyBuilder"
 * import { Context, Effect } from "effect"
 *
 * const Sticky = Context.Reference<boolean>("demo/Sticky", {
 *   defaultValue: () => true,
 * })
 * const Yield = Context.Reference<Effect.Effect<boolean>>("demo/Yield", {
 *   defaultValue: () => Effect.succeed(true),
 * })
 *
 * class Demo extends PolicyBuilder.make("demo/Policy")
 *   .key("Sticky", Sticky)
 *   .keyEncoded(
 *     "Yield",
 *     Yield,
 *     (input: boolean | Effect.Effect<boolean>) =>
 *       typeof input === "boolean" ? Effect.succeed(input) : input,
 *   )
 * {}
 *
 * const bundle = Demo.make({ Sticky: true, Yield: false }).pipe(
 *   Demo.layer(Demo.succeed("Sticky", false)),
 * )
 * ```
 *
 * Apps normally import domain modules (`Policy`, …). Use this builder when
 * minting another family that must share the architecture.
 *
 * @module PolicyBuilder
 */
import type * as internal from "./internal/policyBuilder";
import * as engine from "./internal/policyBuilder";

// =============================================================================
// Models
// =============================================================================

/**
 * One config key: Context reference + encode (input → runtime value on the Layer).
 *
 * @category models
 * @public
 */
export type KeySpec<Input, Runtime = Input> = internal.PolicyBuilderKeySpec<
  Input,
  Runtime
>;

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
 * Bind a `Context.Reference` as a key spec (identity encode). Prefer fluent
 * {@link Family.key} on a {@link make} constructable; this helper is for
 * composing specs by hand.
 *
 * @category constructors
 * @public
 */
export const key: typeof engine.key = engine.key;

/**
 * Bind a `Context.Reference` with a custom encode. Prefer fluent
 * {@link Family.keyEncoded} on a {@link make} constructable.
 *
 * @category constructors
 * @public
 */
export const keyEncoded: typeof engine.keyEncoded = engine.keyEncoded;

/**
 * Empty policy family constructable (HttpApi.`make(id)` analogue).
 *
 * Widen with `.key` / `.keyEncoded`, then `class extends`:
 *
 * ```ts
 * class Demo extends PolicyBuilder.make("demo/Policy")
 *   .key("Sticky", Sticky)
 * {}
 * ```
 *
 * @category constructors
 * @public
 */
export const make: typeof engine.make = engine.make;

/**
 * PolicyBuilder — shared kernel for typed policy families (`LookupPolicy`,
 * `NodePolicy`, …).
 *
 * Each family is a branded `Layer` + frozen config object. Domain modules call
 * {@link define} with a stable `id` and a `keys` map (`Context.Reference` per
 * knob); the builder returns `make` / `layer` / `provide` / `succeed` / `is` /
 * `config` with last-write-wins merge — the same DX as today’s Eng’d `Policy`.
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
 * const Demo = PolicyBuilder.define({
 *   id: "demo/Policy",
 *   keys: {
 *     Sticky: PolicyBuilder.key(Sticky),
 *     Yield: PolicyBuilder.keyEncoded(Yield, (input: boolean | Effect.Effect<boolean>) =>
 *       typeof input === "boolean" ? Effect.succeed(input) : input,
 *     ),
 *   },
 * })
 *
 * const bundle = Demo.make({ Sticky: true, Yield: false }).pipe(
 *   Demo.layer(Demo.succeed("Sticky", false)),
 * )
 * ```
 *
 * Apps normally import domain modules (`Policy` / future `LookupPolicy` /
 * `NodePolicy`), not this builder. Use {@link define} when minting another
 * family that must share the architecture.
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
 * Config object shape derived from a {@link define} keys map.
 *
 * @category models
 * @public
 */
export type ConfigOfKeys<
  Keys extends Record<string, KeySpec<any, any>>,
> = internal.PolicyBuilderConfigOfKeys<Keys>;

/**
 * Family API returned by {@link define}.
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
 * Bind a `Context.Reference` as a policy key (identity encode — input = runtime).
 *
 * @category constructors
 * @public
 */
export const key: typeof engine.key = engine.key;

/**
 * Bind a `Context.Reference` with a custom input→runtime encode (e.g. Yield
 * `boolean | Effect` → `Effect`).
 *
 * @category constructors
 * @public
 */
export const keyEncoded: typeof engine.keyEncoded = engine.keyEncoded;

/**
 * Define a policy family from a stable brand `id` and a `keys` map.
 *
 * @category constructors
 * @public
 */
export const define: typeof engine.define = engine.define;

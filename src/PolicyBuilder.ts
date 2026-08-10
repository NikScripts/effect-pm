/**
 * PolicyBuilder — HttpApi-shaped constructable kernel for policy modules
 * (`Policy` / future `LookupPolicy` / `NodePolicy`).
 *
 * **Two layers:**
 * 1. **Constructable** — `class X extends PolicyBuilder.make(id).key(name, schema, opts)`.
 *    Each key is a Schema + a derived {@link Context.Reference}
 *    (`defaultValue` is the Reference default — same form as Effect).
 * 2. **Module** — recreate helpers (`sticky`, `streamGap`, re-export
 *    `X.references.*`) — hand-written DX in most cases.
 *
 * Fragments are a **tagged sum** (`_tag` = knob name). Product bags stay
 * untagged; `make` accepts either a bag or a `Fragment[]`.
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
 * export const sticky = Demo.succeed({ _tag: "Sticky", value: true })
 *
 * const bundle = Demo.make({ Sticky: true }).pipe(
 *   Demo.layer(Demo.succeed({ _tag: "Sticky", value: false })),
 * )
 * // or: Demo.make([{ _tag: "Sticky", value: true }])
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
 * `class extends`. `defaultValue` is the Context.Reference default — ambient
 * `yield* Ref` when no override Layer is provided.
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

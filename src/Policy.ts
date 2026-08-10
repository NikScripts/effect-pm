/**
 * Policy — composable behaviour fragments (client dial, verify, advertise conflict, yield).
 *
 * Built on {@link PolicyBuilder}: each knob is one PascalCase **handle** —
 * a Context.Reference (`yield* Policy.Sticky`) that is also callable
 * (`Policy.Sticky(true)` → branded {@link Policy} Layer). Mode presets
 * (`verifyOff`, `askIncumbent`, …) name concrete wire choices; there is no
 * camelCase Layer mirror and no `Fragment.*` nest.
 *
 * ```ts
 * import * as Policy from "hyperlink-ts/Policy"
 *
 * const cutover = Policy.make({ Sticky: true, StreamGap: "stall", Verify: "reject" }).pipe(
 *   Policy.layer(Policy.verifyOff),
 *   Policy.layer(Policy.StreamGap("buffer")),
 * )
 * // Policy.Policy<{ Sticky: true; StreamGap: "buffer"; Verify: false }>
 *
 * Policy.layer(Policy.Sticky(true), Policy.StreamGap("stall"), Policy.verifyOff)
 *
 * Hyperlink.lookupClient(Mail).pipe(
 *   Policy.provide(cutover),
 *   Layer.provide(Lookup.layer),
 * )
 * ```
 *
 * @module Policy
 */
import { Effect, Layer, Schema } from "effect";
import type { DirectoryEntry } from "./Directory";
import * as PolicyBuilder from "./PolicyBuilder";

/**
 * Brand id + Context.Reference prefix (`${id}/Sticky`, …).
 * Future rename target: `LookupPolicy` / `hyperlink-ts/LookupPolicy`.
 */
const builderId = "hyperlink-ts/Policy" as const;

// =============================================================================
// Schemas (value shapes for PolicyBuilder keys)
// =============================================================================

/**
 * Soft pick when directory N&gt;1 and no live Advice prefer matches a row.
 *
 * @category schemas
 * @public
 */
export const pickSchema = Schema.Union([
  Schema.Literal("first"),
  Schema.declare(
    (u: unknown): u is (rows: ReadonlyArray<DirectoryEntry>) => DirectoryEntry =>
      typeof u === "function",
  ),
]);

/**
 * Stream seam across dial rebind.
 *
 * @category schemas
 * @public
 */
export const streamGapSchema = Schema.Literals(["stall", "drop", "buffer"]);

/**
 * Cold N&gt;1 without Advice.
 *
 * @category schemas
 * @public
 */
export const coldAmbiguousSchema = Schema.Literals([
  "fail",
  "pickFirst",
  "waitAdvice",
]);

/**
 * Client connection verify mode.
 *
 * @category schemas
 * @public
 */
export const verifySchema = Schema.Union([
  Schema.Literal(false),
  Schema.Literals(["reject", "status"]),
]);

/**
 * Directory advertise conflict preference.
 *
 * @category schemas
 * @public
 */
export const onConflictSchema = Schema.Literals([
  "livenessReplace",
  "askIncumbent",
  "reject",
  "inherit",
]);

/**
 * Yield config input — boolean shorthand or a custom Effect handler.
 *
 * @category schemas
 * @public
 */
export const yieldSchema = Schema.Union([
  Schema.Boolean,
  Schema.declare((u: unknown): u is Effect.Effect<boolean> =>
    Effect.isEffect(u),
  ),
]);

// =============================================================================
// Models
// =============================================================================

/**
 * Soft pick when directory N&gt;1 and no live Advice prefer matches a row.
 *
 * @category models
 * @public
 */
export type Pick = Schema.Schema.Type<typeof pickSchema>;

/**
 * How a live client Stream behaves across a dial swap / transport gap.
 *
 * - `"stall"` — outer stream stays open; no elements until the next dial is live
 * - `"drop"` — skip the gap (inner completes empty); resume on next dial
 * - `"buffer"` — like stall, with a small outer buffer for slow consumers
 *
 * @category models
 * @public
 */
export type StreamGap = Schema.Schema.Type<typeof streamGapSchema>;

/**
 * Cold {@link Hyperlink.lookupClient} when Directory has N&gt;1 rows and Advice misses.
 *
 * - `"fail"` — {@link Hyperlink.LookupClientError} `ambiguous`
 * - `"pickFirst"` — dial `rows[0]`
 * - `"waitAdvice"` — wait until Advice prefer matches a directory row
 *
 * @category models
 * @public
 */
export type ColdAmbiguous = Schema.Schema.Type<typeof coldAmbiguousSchema>;

/**
 * Default-on client connection verify mode.
 *
 * - `"reject"` — probe and fail the client Layer on verify errors (default)
 * - `"status"` — probe; record status without failing the Layer build
 * - `false` — skip the probe
 *
 * @category models
 * @public
 */
export type Verify = Schema.Schema.Type<typeof verifySchema>;

/**
 * Directory advertise conflict preference.
 *
 * - `livenessReplace` — ping incumbent; dead → replace; alive → `IncumbentAlive`
 * - `askIncumbent` — cooperative yield ask on a live incumbent
 * - `reject` — alive → reject; dead → still replace
 * - `inherit` — continue up the resolve chain
 *
 * @category models
 * @public
 */
export type OnConflict = Schema.Schema.Type<typeof onConflictSchema>;

/**
 * Concrete advertise conflict policy (no `"inherit"`) — what Lookup runs.
 *
 * @category models
 * @public
 */
export type OnConflictResolved = Exclude<OnConflict, "inherit">;

/**
 * Product bag for {@link make} / stamped {@link config}. Keys match Context
 * references (PascalCase). Untagged — see {@link Fragment} for the sum form.
 *
 * `Yield` accepts `true` / `false` (accept / refuse) or a custom
 * `Effect.Effect<boolean>`.
 *
 * @category models
 * @public
 */
export type Config = {
  readonly Sticky?: boolean;
  readonly StreamGap?: StreamGap;
  readonly ColdAmbiguous?: ColdAmbiguous;
  readonly Pick?: Pick;
  readonly Verify?: Verify;
  readonly Conflict?: OnConflict;
  readonly Yield?: boolean | Effect.Effect<boolean>;
};

/**
 * Tagged override entry — `_tag` is the knob name; `value` is the schema input.
 * Prefer handles (`Policy.Sticky(true)`) for Layers; use literals /
 * {@link $fromConfig} when you need the data sum.
 *
 * @category models
 * @public
 */
export type Fragment =
  | { readonly _tag: "Sticky"; readonly value: boolean }
  | { readonly _tag: "StreamGap"; readonly value: StreamGap }
  | { readonly _tag: "ColdAmbiguous"; readonly value: ColdAmbiguous }
  | { readonly _tag: "Pick"; readonly value: Pick }
  | { readonly _tag: "Verify"; readonly value: Verify }
  | { readonly _tag: "Conflict"; readonly value: OnConflict }
  | {
      readonly _tag: "Yield";
      readonly value: boolean | Effect.Effect<boolean>;
    };

/**
 * Patch `Prev` with `Patch` — patch keys win (same as Layer merge last-write).
 *
 * @category models
 * @public
 */
export type MergeConfigs<
  Prev extends Config,
  Patch extends Config,
> = PolicyBuilder.MergeConfigs<Prev, Patch>;

/**
 * A policy fragment / bundle that **is** a `Layer.Layer<never>` and stores its
 * mode {@link Config} at runtime. {@link layer} merges Layers and configs together.
 *
 * @category models
 * @public
 */
export type Policy<C extends Config = Config> = PolicyBuilder.Policy<
  typeof builderId,
  C
>;

/**
 * Config type parameter of a {@link Policy}.
 *
 * @category models
 * @public
 */
export type ConfigOf<P> = PolicyBuilder.ConfigOf<P>;

/**
 * Left-to-right {@link MergeConfigs} over a list of {@link Policy} values.
 *
 * @category models
 * @public
 */
export type MergePolicyList<Ps extends ReadonlyArray<Policy<Config>>> =
  PolicyBuilder.MergePolicyList<typeof builderId, Ps>;

// =============================================================================
// Keys (private constructable — module recreates helpers below)
// =============================================================================

/**
 * Schema-backed keys for this module. Not exported — use flat `Policy.*` handles.
 *
 * `defaultValue` on each key is the Context.Reference default (ambient
 * `yield* Sticky` when no override Layer is provided). Handles / `make`
 * override via Layer.
 */
class Keys extends PolicyBuilder.make(builderId)
  .key("Sticky", Schema.Boolean, { defaultValue: () => true })
  .key("StreamGap", streamGapSchema, {
    defaultValue: (): StreamGap => "stall",
  })
  .key("ColdAmbiguous", coldAmbiguousSchema, {
    defaultValue: (): ColdAmbiguous => "fail",
  })
  .key("Pick", Schema.Union([pickSchema, Schema.Undefined]), {
    defaultValue: (): Pick | undefined => undefined,
  })
  .key("Verify", verifySchema, { defaultValue: (): Verify => "reject" })
  .key("Conflict", onConflictSchema, {
    defaultValue: (): OnConflict => "inherit",
  })
  .key("Yield", yieldSchema, {
    defaultValue: (): Effect.Effect<boolean> => Effect.succeed(true),
    toRuntime: (input: Schema.Schema.Type<typeof yieldSchema>) =>
      typeof input === "boolean" ? Effect.succeed(input) : input,
  }) {}

// =============================================================================
// Handles (Reference + callable Layer)
// =============================================================================

/**
 * Warm dual-serve stickiness. Default `true`.
 * `yield* Sticky` / `Sticky(true)` → Layer.
 *
 * @category handles
 * @public
 */
export const Sticky = Keys.Sticky;

/**
 * Stream seam across dial rebind. Default `"stall"`.
 * `yield* StreamGap` / `StreamGap("buffer")` → Layer.
 *
 * @category handles
 * @public
 */
export const StreamGap = Keys.StreamGap;

/**
 * Cold N&gt;1 without Advice. Default `"fail"`.
 *
 * @category handles
 * @public
 */
export const ColdAmbiguous = Keys.ColdAmbiguous;

/**
 * Optional soft pick (D4). Default unset — cold policy applies instead.
 *
 * @category handles
 * @public
 */
export const Pick = Keys.Pick;

/**
 * Ambient client-verify mode. Default `"reject"`.
 *
 * @category handles
 * @public
 */
export const Verify = Keys.Verify;

/**
 * Ambient advertise conflict preference (call-site / node stamp still win).
 * Default `"inherit"`.
 *
 * @category handles
 * @public
 */
export const Conflict = Keys.Conflict;

/**
 * Cooperative yield handler for `"askIncumbent"` — `true` = step aside.
 * Default accept. ListenOptions.`onYield` wins when set.
 *
 * @category handles
 * @public
 */
export const Yield = Keys.Yield;

// =============================================================================
// Mode presets (named wire choices — not key mirrors)
// =============================================================================

/** Verify and reject on failure (default). @category layers @public */
export const verifyReject: Policy<{ Verify: "reject" }> = Verify("reject");

/** Verify; keep status without failing Layer build. @category layers @public */
export const verifyStatus: Policy<{ Verify: "status" }> = Verify("status");

/** Skip client verify probe. @category layers @public */
export const verifyOff: Policy<{ Verify: false }> = Verify(false);

/** Advertise: liveness ping replace. @category layers @public */
export const livenessReplace: Policy<{ Conflict: "livenessReplace" }> =
  Conflict("livenessReplace");

/** Advertise: ask incumbent to yield. @category layers @public */
export const askIncumbent: Policy<{ Conflict: "askIncumbent" }> =
  Conflict("askIncumbent");

/** Advertise: reject when incumbent alive. @category layers @public */
export const conflictReject: Policy<{ Conflict: "reject" }> =
  Conflict("reject");

/** Advertise: inherit up the chain (default ambient). @category layers @public */
export const conflictInherit: Policy<{ Conflict: "inherit" }> =
  Conflict("inherit");

/** Accept askIncumbent yield (default). @category layers @public */
export const yieldAccept: Policy<{ Yield: true }> = Yield(true);

/** Refuse askIncumbent yield. @category layers @public */
export const yieldRefuse: Policy<{ Yield: false }> = Yield(false);

/**
 * Walk preference layers (first concrete wins). Hard fallback: `livenessReplace`.
 *
 * @category utils
 * @public
 */
export const resolveOnConflict = (
  ...prefs: ReadonlyArray<OnConflict | undefined>
): OnConflictResolved => {
  for (const pref of prefs) {
    if (pref !== undefined && pref !== "inherit") {
      return pref;
    }
  }
  return "livenessReplace";
};

/** Read a node's stamped {@link OnConflict}, if any. @internal */
export const onConflictOf = (node: unknown): OnConflict | undefined => {
  if (
    (typeof node === "object" || typeof node === "function") &&
    node !== null &&
    "onConflict" in node
  ) {
    const value = (node as { readonly onConflict?: unknown }).onConflict;
    if (
      value === "livenessReplace" ||
      value === "askIncumbent" ||
      value === "reject" ||
      value === "inherit"
    ) {
      return value;
    }
  }
  return undefined;
};

// =============================================================================
// Fragment matchers / bag converters
// =============================================================================

/**
 * Type guard for a tagged {@link Fragment} by `_tag`.
 *
 * @category guards
 * @public
 */
export const $is = Keys.$is;

/**
 * Exhaustive match over a {@link Fragment} (dual).
 *
 * @category utils
 * @public
 */
export const $match = Keys.$match;

/**
 * Product {@link Config} → {@link Fragment} list (present keys only).
 *
 * @category constructors
 * @public
 */
export const $fromConfig = Keys.$fromConfig.bind(Keys);

/**
 * {@link Fragment} list → product bag (last write wins).
 *
 * @category constructors
 * @public
 */
export const $toConfig = Keys.$toConfig.bind(Keys);

// =============================================================================
// layer / make / provide / guards
// =============================================================================

/**
 * Type guard for {@link Policy} values.
 *
 * @category guards
 * @public
 */
export const isPolicy = (u: unknown): u is Policy<Config> => Keys.is(u);

/**
 * Read the runtime config stamped on a {@link Policy}.
 *
 * @category getters
 * @public
 */
export const config = <C extends Config>(self: Policy<C>): C =>
  Keys.config(self);

/**
 * Merge policy Layers (last write wins per reference) **and** expand configs.
 *
 * `dual`: pipeable unary or data-first variadic (2+).
 *
 * ```ts
 * const cutover = Policy.make({ StreamGap: "stall", Verify: "reject" }).pipe(
 *   Policy.layer(Policy.verifyOff),
 *   Policy.layer(Policy.StreamGap("buffer")),
 * )
 * // Policy.Policy<{ StreamGap: "buffer"; Verify: false }>
 *
 * Policy.layer(Policy.Sticky(true), Policy.StreamGap("stall"), Policy.verifyOff)
 * ```
 *
 * @category layers
 * @public
 */
export const layer: typeof Keys.layer = Keys.layer;

/**
 * One tagged {@link Fragment} → branded single-key {@link Policy}.
 * Prefer the handle call (`Policy.Sticky(true)`) for the same result.
 *
 * @category constructors
 * @public
 */
export const succeed: typeof Keys.succeed = Keys.succeed.bind(Keys);

/**
 * Build a {@link Policy} from a product {@link Config} bag **or** a
 * {@link Fragment} list. Stamps a product bag as runtime {@link config};
 * compose with {@link layer} (pipe or data-first).
 *
 * ```ts
 * const cutover = Policy.make({
 *   Sticky: true,
 *   StreamGap: "stall",
 *   Verify: "reject",
 * }).pipe(Policy.layer(Policy.verifyOff))
 * ```
 *
 * @category constructors
 * @public
 */
export const make: {
  <const C extends Config>(config: C): Policy<C>;
  <const Fs extends ReadonlyArray<Fragment>>(
    fragments: Fs,
  ): Policy<PolicyBuilder.ConfigFromFragments<Fs>>;
} = Keys.make.bind(Keys);

/**
 * Provide policy Layers onto a Layer (no stacked `Layer.provide`s).
 * Accepts {@link make} bundles, handle calls, mode presets, {@link layer}
 * results, or a mix — last write wins per reference.
 *
 * ```ts
 * Hyperlink.lookupClient(Mail).pipe(
 *   Policy.provide(
 *     Policy.make({ Sticky: true, StreamGap: "stall" }).pipe(
 *       Policy.layer(Policy.verifyOff),
 *     ),
 *   ),
 *   Layer.provide(Lookup.layer),
 * )
 * ```
 *
 * @category layers
 * @public
 */
export const provide =
  (...policies: ReadonlyArray<Layer.Layer<never>>) =>
  <A, E, R>(self: Layer.Layer<A, E, R>): Layer.Layer<A, E, R> =>
    Keys.provide(...policies)(self);

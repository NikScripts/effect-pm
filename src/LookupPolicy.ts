/**
 * LookupPolicy — Lookup / Directory participation (dial, verify, claim, yield).
 *
 * Built on {@link PolicyBuilder}: private plural constructable `LookupPolicies`
 * declares Schema keys / PascalCase References and camelCase Layer methods
 * (`Uncapitalize` — `"Sticky"` → `sticky`). This singular module re-exports
 * those plus mode presets. Apps import this namespace — not the builder.
 *
 * Pairs with `Lookup`. Sister module: {@link NodePolicy} (this-process address
 * list knobs).
 *
 * ```ts
 * import * as LookupPolicy from "hyperlink-ts/LookupPolicy"
 *
 * const cutover = LookupPolicy.make({ Sticky: true, StreamGap: "stall", Verify: "reject" }).pipe(
 *   LookupPolicy.layer(LookupPolicy.verifyOff),
 *   LookupPolicy.layer(LookupPolicy.streamGap("buffer")),
 * )
 *
 * Hyperlink.lookupClient(Mail).pipe(
 *   LookupPolicy.provide(cutover),
 *   Layer.provide(Lookup.layer),
 * )
 * ```
 *
 * @module LookupPolicy
 */
import { Effect, Layer, Schema } from "effect";
import type { DirectoryEntry } from "./Directory";
import * as PolicyBuilder from "./PolicyBuilder";

/** Brand id + Context.Reference prefix (`${id}/Sticky`, …). */
const builderId = "hyperlink-ts/LookupPolicy" as const;

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
 * Prefer camelCase Layer helpers for apps; use literals / {@link fromConfig}
 * when you need the data sum.
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
// LookupPolicies (private constructable — module re-exports below)
// =============================================================================

/**
 * Private plural constructable. Singular module namespace is `LookupPolicy`.
 * Each key adds a PascalCase Reference and a camelCase Layer method
 * (`Uncapitalize` — `"StreamGap"` → `streamGap`).
 *
 * `defaultValue` on each key is the Context.Reference default (ambient
 * `yield* Sticky` when no override Layer is provided).
 */
class LookupPolicies extends PolicyBuilder.make(builderId)
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
// References (PascalCase — Context.Reference)
// =============================================================================

/**
 * Warm dual-serve stickiness. Default `true` (Reference default).
 *
 * @category references
 * @public
 */
export const Sticky = LookupPolicies.Sticky;

/**
 * Stream seam across dial rebind. Default `"stall"` (Reference default).
 *
 * @category references
 * @public
 */
export const StreamGap = LookupPolicies.StreamGap;

/**
 * Cold N&gt;1 without Advice. Default `"fail"` (Reference default).
 *
 * @category references
 * @public
 */
export const ColdAmbiguous = LookupPolicies.ColdAmbiguous;

/**
 * Optional soft pick (D4). Default unset — cold policy applies instead.
 *
 * @category references
 * @public
 */
export const Pick = LookupPolicies.Pick;

/**
 * Ambient client-verify mode. Default `"reject"` (Reference default).
 *
 * @category references
 * @public
 */
export const Verify = LookupPolicies.Verify;

/**
 * Ambient advertise conflict preference (call-site / node stamp still win).
 * Default `"inherit"` (Reference default).
 *
 * @category references
 * @public
 */
export const Conflict = LookupPolicies.Conflict;

/**
 * Cooperative yield handler for `"askIncumbent"` — `true` = step aside.
 * Default accept (Reference default). ListenOptions.`onYield` wins when set.
 *
 * @category references
 * @public
 */
export const Yield = LookupPolicies.Yield;

// =============================================================================
// Layer helpers (camelCase — Uncapitalize of PascalCase key / `_tag`)
// =============================================================================

/** Keep the current dial across dual-serve (default on). @category layers @public */
export const sticky: Policy<{ Sticky: true }> = LookupPolicies.sticky(true);

/** Disable warm stickiness. @category layers @public */
export const unsticky: Policy<{ Sticky: false }> = LookupPolicies.sticky(false);

/** Stream seam mode. @category layers @public */
export const streamGap = LookupPolicies.streamGap;

/** Cold N&gt;1 behaviour. @category layers @public */
export const coldAmbiguous = LookupPolicies.coldAmbiguous;

/** Soft pick when N&gt;1 and Advice misses. @category layers @public */
export const pick = LookupPolicies.pick;

/** Verify and reject on failure (default). @category layers @public */
export const verifyReject: Policy<{ Verify: "reject" }> =
  LookupPolicies.verify("reject");

/** Verify; keep status without failing Layer build. @category layers @public */
export const verifyStatus: Policy<{ Verify: "status" }> =
  LookupPolicies.verify("status");

/** Skip client verify probe. @category layers @public */
export const verifyOff: Policy<{ Verify: false }> = LookupPolicies.verify(false);

/** Set client verify mode. @category layers @public */
export const verify = LookupPolicies.verify;

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

/** Advertise: liveness ping replace. @category layers @public */
export const livenessReplace: Policy<{ Conflict: "livenessReplace" }> =
  LookupPolicies.conflict("livenessReplace");

/** Advertise: ask incumbent to yield. @category layers @public */
export const askIncumbent: Policy<{ Conflict: "askIncumbent" }> =
  LookupPolicies.conflict("askIncumbent");

/** Advertise: reject when incumbent alive. @category layers @public */
export const conflictReject: Policy<{ Conflict: "reject" }> =
  LookupPolicies.conflict("reject");

/** Advertise: inherit up the chain (default ambient). @category layers @public */
export const conflictInherit: Policy<{ Conflict: "inherit" }> =
  LookupPolicies.conflict("inherit");

/**
 * Set advertise conflict preference (`Uncapitalize("Conflict")` → `conflict`
 * on the constructable; module export keeps the `on*` mode-preset name).
 *
 * @category layers
 * @public
 */
export const onConflict = LookupPolicies.conflict;

/** Accept askIncumbent yield (default). @category layers @public */
export const yieldAccept: Policy<{ Yield: true }> = LookupPolicies.yield(true);

/** Refuse askIncumbent yield. @category layers @public */
export const yieldRefuse: Policy<{ Yield: false }> = LookupPolicies.yield(false);

/**
 * Custom yield handler (`Uncapitalize("Yield")` → `yield` on the constructable;
 * module export keeps the `on*` mode-preset name).
 *
 * @category layers
 * @public
 */
export const onYield = LookupPolicies.yield;

// =============================================================================
// Fragment matchers / bag converters
// =============================================================================

/**
 * Type guard for a tagged {@link Fragment} by `_tag`.
 *
 * @category guards
 * @public
 */
export const isFragment = LookupPolicies.isFragment;

/**
 * Exhaustive match over a {@link Fragment} (dual).
 *
 * @category utils
 * @public
 */
export const matchFragment = LookupPolicies.matchFragment;

/**
 * Product {@link Config} → {@link Fragment} list (present keys only).
 *
 * @category constructors
 * @public
 */
export const fromConfig = LookupPolicies.fromConfig.bind(LookupPolicies);

/**
 * {@link Fragment} list → product bag (last write wins).
 *
 * @category constructors
 * @public
 */
export const toConfig = LookupPolicies.toConfig.bind(LookupPolicies);

// =============================================================================
// layer / make / provide / guards
// =============================================================================

/**
 * Type guard for {@link Policy} values.
 *
 * @category guards
 * @public
 */
export const isPolicy = (u: unknown): u is Policy<Config> => LookupPolicies.is(u);

/**
 * Read the runtime config stamped on a {@link Policy}.
 *
 * @category getters
 * @public
 */
export const config = <C extends Config>(self: Policy<C>): C =>
  LookupPolicies.config(self);

/**
 * Merge policy Layers (last write wins per reference) **and** expand configs.
 *
 * `dual`: pipeable unary or data-first variadic (2+).
 *
 * ```ts
 * const cutover = LookupPolicy.make({ StreamGap: "stall", Verify: "reject" }).pipe(
 *   LookupPolicy.layer(LookupPolicy.verifyOff),
 *   LookupPolicy.layer(LookupPolicy.streamGap("buffer")),
 * )
 * // LookupPolicy.Policy<{ StreamGap: "buffer"; Verify: false }>
 *
 * LookupPolicy.layer(LookupPolicy.sticky, LookupPolicy.streamGap("stall"), LookupPolicy.verifyOff)
 * ```
 *
 * @category layers
 * @public
 */
export const layer: typeof LookupPolicies.layer = LookupPolicies.layer;

/**
 * One tagged {@link Fragment} → branded single-key {@link Policy}.
 * Prefer camelCase helpers (`sticky`, `streamGap`, …) for the same result.
 *
 * @category constructors
 * @public
 */
export const succeed: typeof LookupPolicies.succeed =
  LookupPolicies.succeed.bind(LookupPolicies);

/**
 * Build a {@link Policy} from a product {@link Config} bag **or** a
 * {@link Fragment} list. Stamps a product bag as runtime {@link config};
 * compose with {@link layer} (pipe or data-first).
 *
 * ```ts
 * const cutover = LookupPolicy.make({
 *   Sticky: true,
 *   StreamGap: "stall",
 *   Verify: "reject",
 * }).pipe(LookupPolicy.layer(LookupPolicy.verifyOff))
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
} = LookupPolicies.make.bind(LookupPolicies);

/**
 * Provide policy Layers onto a Layer (no stacked `Layer.provide`s).
 * Accepts {@link make} bundles, typed fragments, mode presets, {@link layer}
 * results, or a mix — last write wins per reference.
 *
 * ```ts
 * Hyperlink.lookupClient(Mail).pipe(
 *   LookupPolicy.provide(
 *     LookupPolicy.make({ Sticky: true, StreamGap: "stall" }).pipe(
 *       LookupPolicy.layer(LookupPolicy.verifyOff),
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
    LookupPolicies.provide(...policies)(self);

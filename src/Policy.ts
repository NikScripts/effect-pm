/**
 * Policy — composable behaviour fragments (client dial, verify, advertise conflict, yield).
 *
 * Every fragment is a {@link Policy}: a real `Layer` that carries its mode config at
 * runtime (not a phantom cast). {@link layer} is `dual` — data-first merge or
 * `.pipe(Policy.layer(other))` — and expands the config type (last write wins).
 *
 * ```ts
 * import * as Policy from "hyperlink-ts/Policy"
 *
 * const cutover = Policy.make({ Sticky: true, StreamGap: "stall", Verify: "reject" }).pipe(
 *   Policy.layer(Policy.verifyOff),
 *   Policy.layer(Policy.streamGap("buffer")),
 * )
 * // Policy.Policy<{ Sticky: true; StreamGap: "buffer"; Verify: false }>
 *
 * // Same expand, data-first
 * Policy.layer(cutover, Policy.askIncumbent, Policy.yieldAccept)
 *
 * Hyperlink.lookupClient(Mail).pipe(
 *   Policy.provide(cutover),
 *   Layer.provide(Lookup.layer),
 * )
 * ```
 *
 * @module Policy
 */
import { Context, Effect, Layer } from "effect";
import { dual } from "effect/Function";
import { hasProperty } from "effect/Predicate";
import type { DirectoryEntry } from "./Directory";

/** Brand for {@link Policy} Layers. @internal */
const TypeId = "~hyperlink-ts/Policy" as const;

/** Runtime config slot on a {@link Policy}. @internal */
const ConfigId = "~hyperlink-ts/Policy/Config" as const;

// =============================================================================
// Models
// =============================================================================

/**
 * Soft pick when directory N&gt;1 and no live Advice prefer matches a row.
 *
 * @category models
 * @public
 */
export type Pick =
  | "first"
  | ((rows: ReadonlyArray<DirectoryEntry>) => DirectoryEntry);

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
export type StreamGap = "stall" | "drop" | "buffer";

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
export type ColdAmbiguous = "fail" | "pickFirst" | "waitAdvice";

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
export type Verify = false | "reject" | "status";

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
export type OnConflict =
  | "livenessReplace"
  | "askIncumbent"
  | "reject"
  | "inherit";

/**
 * Concrete advertise conflict policy (no `"inherit"`) — what Lookup runs.
 *
 * @category models
 * @public
 */
export type OnConflictResolved = Exclude<OnConflict, "inherit">;

/**
 * Object form for {@link make} / fragment config. Keys match Context references
 * (PascalCase).
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
 * Patch `Prev` with `Patch` — patch keys win (same as Layer merge last-write).
 *
 * @category models
 * @public
 */
export type MergeConfigs<Prev extends Config, Patch extends Config> = Omit<
  Prev,
  keyof Patch
> &
  Patch;

/**
 * Config type parameter of a {@link Policy}.
 *
 * @category models
 * @public
 */
export type ConfigOf<P> = P extends Policy<infer C> ? C : never;

/**
 * Left-to-right {@link MergeConfigs} over a list of {@link Policy} values.
 *
 * @category models
 * @public
 */
export type MergePolicyList<Ps extends ReadonlyArray<Policy<Config>>> =
  Ps extends readonly []
    ? {}
    : Ps extends readonly [Policy<infer H>]
      ? H
      : Ps extends readonly [Policy<infer H>, ...infer Rest]
        ? Rest extends ReadonlyArray<Policy<Config>>
          ? MergeConfigs<H, MergePolicyList<Rest>>
          : H
        : {};

/**
 * A policy fragment / bundle that **is** a `Layer.Layer<never>` and stores its
 * mode {@link Config} at runtime. {@link layer} merges Layers and configs together.
 *
 * @category models
 * @public
 */
export interface Policy<out C extends Config = Config>
  extends Layer.Layer<never>
{
  readonly [TypeId]: typeof TypeId;
  readonly [ConfigId]: C;
}

/**
 * Type guard for {@link Policy} values.
 *
 * @category guards
 * @public
 */
export const isPolicy = (u: unknown): u is Policy<Config> =>
  hasProperty(u, TypeId);

/**
 * Read the runtime config stamped on a {@link Policy}.
 *
 * @category getters
 * @public
 */
export const config = <C extends Config>(self: Policy<C>): C => self[ConfigId];

/** Build a Policy that is the underlying Layer + frozen config. @internal */
const makePolicy = <const C extends Config>(
  underlying: Layer.Layer<never>,
  cfg: C,
): Policy<C> =>
  Object.assign(Object.create(Object.getPrototypeOf(underlying)), underlying, {
    [TypeId]: TypeId,
    [ConfigId]: Object.freeze({ ...cfg }),
  }) as Policy<C>;

/** Merge Layers + configs (last write wins). @internal */
const combine = (
  policies: ReadonlyArray<Policy<Config>>,
): Policy<Config> => {
  let cfg: Config = {};
  for (const p of policies) {
    cfg = { ...cfg, ...p[ConfigId] };
  }
  if (policies.length === 0) {
    return makePolicy(Layer.empty, cfg);
  }
  if (policies.length === 1) {
    return makePolicy(policies[0]!, cfg);
  }
  return makePolicy(
    Layer.mergeAll(policies[0]!, policies[1]!, ...policies.slice(2)),
    cfg,
  );
};

// =============================================================================
// Dial / cutover references + fragments
// =============================================================================

/**
 * Warm dual-serve stickiness. Default `true`.
 *
 * @category references
 * @public
 */
export const Sticky = Context.Reference<boolean>("hyperlink-ts/Policy/Sticky", {
  defaultValue: (): boolean => true,
});

/**
 * Stream seam across dial rebind. Default `"stall"`.
 *
 * @category references
 * @public
 */
export const StreamGap: Context.Reference<StreamGap> =
  Context.Reference<StreamGap>("hyperlink-ts/Policy/StreamGap", {
    defaultValue: (): StreamGap => "stall",
  });

/**
 * Cold N&gt;1 without Advice. Default `"fail"`.
 *
 * @category references
 * @public
 */
export const ColdAmbiguous: Context.Reference<ColdAmbiguous> =
  Context.Reference<ColdAmbiguous>("hyperlink-ts/Policy/ColdAmbiguous", {
    defaultValue: (): ColdAmbiguous => "fail",
  });

/**
 * Optional soft pick (D4). Default unset — cold policy applies instead.
 *
 * @category references
 * @public
 */
export const Pick: Context.Reference<Pick | undefined> = Context.Reference<
  Pick | undefined
>("hyperlink-ts/Policy/Pick", {
  defaultValue: (): undefined => undefined,
});

/** Keep the current dial across dual-serve (default on). @category layers @public */
export const sticky: Policy<{ Sticky: true }> = makePolicy(
  Layer.succeed(Sticky, true),
  { Sticky: true },
);

/** Disable warm stickiness. @category layers @public */
export const unsticky: Policy<{ Sticky: false }> = makePolicy(
  Layer.succeed(Sticky, false),
  { Sticky: false },
);

/** Stream seam mode. @category layers @public */
export const streamGap = <const M extends StreamGap>(
  mode: M,
): Policy<{ StreamGap: M }> =>
  makePolicy(Layer.succeed(StreamGap, mode), { StreamGap: mode });

/** Cold N&gt;1 behaviour. @category layers @public */
export const coldAmbiguous = <const M extends ColdAmbiguous>(
  mode: M,
): Policy<{ ColdAmbiguous: M }> =>
  makePolicy(Layer.succeed(ColdAmbiguous, mode), { ColdAmbiguous: mode });

/** Soft pick when N&gt;1 and Advice misses. @category layers @public */
export const pick = <const M extends Pick>(mode: M): Policy<{ Pick: M }> =>
  makePolicy(Layer.succeed(Pick, mode), { Pick: mode });

// =============================================================================
// Client verify
// =============================================================================

/**
 * Ambient client-verify mode. Default `"reject"`.
 *
 * @category references
 * @public
 */
export const Verify: Context.Reference<Verify> = Context.Reference<Verify>(
  "hyperlink-ts/Policy/Verify",
  { defaultValue: (): Verify => "reject" },
);

/** Verify and reject on failure (default). @category layers @public */
export const verifyReject: Policy<{ Verify: "reject" }> = makePolicy(
  Layer.succeed(Verify, "reject"),
  { Verify: "reject" },
);

/** Verify; keep status without failing Layer build. @category layers @public */
export const verifyStatus: Policy<{ Verify: "status" }> = makePolicy(
  Layer.succeed(Verify, "status"),
  { Verify: "status" },
);

/** Skip client verify probe. @category layers @public */
export const verifyOff: Policy<{ Verify: false }> = makePolicy(
  Layer.succeed(Verify, false),
  { Verify: false },
);

/** Set client verify mode. @category layers @public */
export const verify = <const M extends Verify>(
  mode: M,
): Policy<{ Verify: M }> =>
  makePolicy(Layer.succeed(Verify, mode), { Verify: mode });

// =============================================================================
// Advertise conflict
// =============================================================================

/**
 * Ambient advertise conflict preference (call-site / node stamp still win).
 * Default `"inherit"`.
 *
 * @category references
 * @public
 */
export const Conflict: Context.Reference<OnConflict> =
  Context.Reference<OnConflict>("hyperlink-ts/Policy/Conflict", {
    defaultValue: (): OnConflict => "inherit",
  });

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
  makePolicy(Layer.succeed(Conflict, "livenessReplace"), {
    Conflict: "livenessReplace",
  });

/** Advertise: ask incumbent to yield. @category layers @public */
export const askIncumbent: Policy<{ Conflict: "askIncumbent" }> = makePolicy(
  Layer.succeed(Conflict, "askIncumbent"),
  { Conflict: "askIncumbent" },
);

/** Advertise: reject when incumbent alive. @category layers @public */
export const conflictReject: Policy<{ Conflict: "reject" }> = makePolicy(
  Layer.succeed(Conflict, "reject"),
  { Conflict: "reject" },
);

/** Advertise: inherit up the chain (default ambient). @category layers @public */
export const conflictInherit: Policy<{ Conflict: "inherit" }> = makePolicy(
  Layer.succeed(Conflict, "inherit"),
  { Conflict: "inherit" },
);

/** Set advertise conflict preference. @category layers @public */
export const onConflict = <const M extends OnConflict>(
  mode: M,
): Policy<{ Conflict: M }> =>
  makePolicy(Layer.succeed(Conflict, mode), { Conflict: mode });

// =============================================================================
// Yield (askIncumbent cooperative accept / refuse)
// =============================================================================

/**
 * Cooperative yield handler for `"askIncumbent"` — `true` = step aside.
 * Default accept. ListenOptions.`onYield` wins when set.
 *
 * @category references
 * @public
 */
export const Yield: Context.Reference<Effect.Effect<boolean>> =
  Context.Reference<Effect.Effect<boolean>>("hyperlink-ts/Policy/Yield", {
    defaultValue: (): Effect.Effect<boolean> => Effect.succeed(true),
  });

/** Accept askIncumbent yield (default). @category layers @public */
export const yieldAccept: Policy<{ Yield: true }> = makePolicy(
  Layer.succeed(Yield, Effect.succeed(true)),
  { Yield: true },
);

/** Refuse askIncumbent yield. @category layers @public */
export const yieldRefuse: Policy<{ Yield: false }> = makePolicy(
  Layer.succeed(Yield, Effect.succeed(false)),
  { Yield: false },
);

/** Custom yield handler. @category layers @public */
export const onYield = <E extends Effect.Effect<boolean>>(
  handler: E,
): Policy<{ Yield: E }> =>
  makePolicy(Layer.succeed(Yield, handler), { Yield: handler });

// =============================================================================
// layer / make / provide
// =============================================================================

/**
 * Merge policy Layers (last write wins per reference) **and** expand configs.
 *
 * `dual`: pipeable unary or data-first variadic (2+).
 *
 * ```ts
 * const cutover = Policy.make({ StreamGap: "stall", Verify: "reject" }).pipe(
 *   Policy.layer(Policy.verifyOff),
 *   Policy.layer(Policy.streamGap("buffer")),
 * )
 * // Policy.Policy<{ StreamGap: "buffer"; Verify: false }>
 *
 * Policy.layer(Policy.sticky, Policy.streamGap("stall"), Policy.verifyOff)
 * ```
 *
 * @category layers
 * @public
 */
export const layer: {
  <const That extends Policy<Config>>(
    that: That,
  ): <const Self extends Policy<Config>>(
    self: Self,
  ) => Policy<MergeConfigs<ConfigOf<Self>, ConfigOf<That>>>;
  <
    const Self extends Policy<Config>,
    const That extends Policy<Config>,
    const Rest extends ReadonlyArray<Policy<Config>>,
  >(
    self: Self,
    that: That,
    ...rest: Rest
  ): Policy<MergePolicyList<readonly [Self, That, ...Rest]>>;
} = dual(
  (args) => args.length >= 2,
  (
    self: Policy<Config>,
    that: Policy<Config>,
    ...rest: ReadonlyArray<Policy<Config>>
  ): Policy<Config> => combine([self, that, ...rest]),
);

/**
 * Build a {@link Policy} from an object. Stamps the same object as runtime
 * {@link config}; compose with {@link layer} (pipe or data-first).
 *
 * ```ts
 * const cutover = Policy.make({
 *   Sticky: true,
 *   StreamGap: "stall",
 *   Verify: "reject",
 * }).pipe(Policy.layer(Policy.verifyOff))
 * // Policy.Policy<{ Sticky: true; StreamGap: "stall"; Verify: false }>
 * ```
 *
 * @category constructors
 * @public
 */
export const make = <const C extends Config>(config: C): Policy<C> => {
  const parts: Array<Layer.Layer<never>> = [];
  if (config.Sticky !== undefined) {
    parts.push(Layer.succeed(Sticky, config.Sticky));
  }
  if (config.StreamGap !== undefined) {
    parts.push(Layer.succeed(StreamGap, config.StreamGap));
  }
  if (config.ColdAmbiguous !== undefined) {
    parts.push(Layer.succeed(ColdAmbiguous, config.ColdAmbiguous));
  }
  if (config.Pick !== undefined) {
    parts.push(Layer.succeed(Pick, config.Pick));
  }
  if (config.Verify !== undefined) {
    parts.push(Layer.succeed(Verify, config.Verify));
  }
  if (config.Conflict !== undefined) {
    parts.push(Layer.succeed(Conflict, config.Conflict));
  }
  if (config.Yield !== undefined) {
    const handler =
      typeof config.Yield === "boolean"
        ? Effect.succeed(config.Yield)
        : config.Yield;
    parts.push(Layer.succeed(Yield, handler));
  }
  const underlying =
    parts.length === 0
      ? Layer.empty
      : parts.length === 1
        ? parts[0]!
        : Layer.mergeAll(parts[0]!, parts[1]!, ...parts.slice(2));
  return makePolicy(underlying, config);
};

/**
 * Provide policy Layers onto a Layer (no stacked `Layer.provide`s).
 * Accepts {@link make} bundles, typed fragments, {@link layer} results, or a
 * mix — last write wins per reference.
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
  <A, E, R>(self: Layer.Layer<A, E, R>): Layer.Layer<A, E, R> => {
    if (policies.length === 0) return self;
    const merged =
      policies.length === 1
        ? policies[0]!
        : Layer.mergeAll(policies[0]!, policies[1]!, ...policies.slice(2));
    return self.pipe(Layer.provide(merged));
  };

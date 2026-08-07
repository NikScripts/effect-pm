/**
 * Policy — composable behaviour fragments (client dial, verify, advertise conflict, yield).
 *
 * Fragments are thin {@link Layer}s over Context references with defaults. Compose with
 * {@link make} / {@link merge} / {@link provide} / {@link layer} — not a second control
 * plane. Node / Listen call-site stamps (`onConflict`, `onYield`) remain overrides that
 * win over ambient Policy.
 *
 * ```ts
 * import * as Policy from "hyperlink-ts/Policy"
 *
 * // Typed bundle — already a Layer (no Layer.Layer wrapper)
 * const cutover = Policy.make({
 *   Sticky: true,
 *   StreamGap: "stall",
 *   ColdAmbiguous: "fail",
 *   Verify: "reject",
 * })
 * // cutover: Policy.Policy<{ Sticky: true; StreamGap: "stall"; … }>
 *
 * Hyperlink.lookupClient(Mail).pipe(
 *   Policy.provide(cutover.pipe(Policy.merge({ Verify: false }))),
 *   Layer.provide(Lookup.layer),
 * )
 *
 * // Or fragment values (untyped Layer.Layer<never>)
 * const fleet = Policy.layer(Policy.askIncumbent, Policy.yieldAccept)
 * Node.unix(Worker, serves).pipe(Policy.provide(fleet))
 * ```
 *
 * @module Policy
 */
import { Context, Effect, Layer } from "effect";
import type { DirectoryEntry } from "./Directory";

/** Brand for {@link Policy} Layers. @internal */
const TypeId = "~hyperlink-ts/Policy" as const;

// =============================================================================
// Dial / cutover
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
export const sticky: Layer.Layer<never> = Layer.succeed(Sticky, true);

/** Disable warm stickiness. @category layers @public */
export const unsticky: Layer.Layer<never> = Layer.succeed(Sticky, false);

/** Stream seam mode. @category layers @public */
export const streamGap = (mode: StreamGap): Layer.Layer<never> =>
  Layer.succeed(StreamGap, mode);

/** Cold N&gt;1 behaviour. @category layers @public */
export const coldAmbiguous = (mode: ColdAmbiguous): Layer.Layer<never> =>
  Layer.succeed(ColdAmbiguous, mode);

/** Soft pick when N&gt;1 and Advice misses. @category layers @public */
export const pick = (mode: Pick): Layer.Layer<never> =>
  Layer.succeed(Pick, mode);

// =============================================================================
// Client verify (was Hyperlink.ClientVerify)
// =============================================================================

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
export const verifyReject: Layer.Layer<never> = Layer.succeed(Verify, "reject");

/** Verify; keep status without failing Layer build. @category layers @public */
export const verifyStatus: Layer.Layer<never> = Layer.succeed(Verify, "status");

/** Skip client verify probe. @category layers @public */
export const verifyOff: Layer.Layer<never> = Layer.succeed(Verify, false);

/** Set client verify mode. @category layers @public */
export const verify = (mode: Verify): Layer.Layer<never> =>
  Layer.succeed(Verify, mode);

// =============================================================================
// Advertise conflict (was Node / Lookup OnConflict)
// =============================================================================

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
export const livenessReplace: Layer.Layer<never> = Layer.succeed(
  Conflict,
  "livenessReplace",
);

/** Advertise: ask incumbent to yield. @category layers @public */
export const askIncumbent: Layer.Layer<never> = Layer.succeed(
  Conflict,
  "askIncumbent",
);

/** Advertise: reject when incumbent alive. @category layers @public */
export const conflictReject: Layer.Layer<never> = Layer.succeed(
  Conflict,
  "reject",
);

/** Advertise: inherit up the chain (default ambient). @category layers @public */
export const conflictInherit: Layer.Layer<never> = Layer.succeed(
  Conflict,
  "inherit",
);

/** Set advertise conflict preference. @category layers @public */
export const onConflict = (mode: OnConflict): Layer.Layer<never> =>
  Layer.succeed(Conflict, mode);

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
export const yieldAccept: Layer.Layer<never> = Layer.succeed(
  Yield,
  Effect.succeed(true),
);

/** Refuse askIncumbent yield. @category layers @public */
export const yieldRefuse: Layer.Layer<never> = Layer.succeed(
  Yield,
  Effect.succeed(false),
);

/** Custom yield handler. @category layers @public */
export const onYield = (
  handler: Effect.Effect<boolean>,
): Layer.Layer<never> => Layer.succeed(Yield, handler);

// =============================================================================
// Helpers
// =============================================================================

/**
 * Merge policy fragments into one Layer (last write wins per reference).
 * Prefer {@link make} when you want the modes in the type.
 *
 * @category layers
 * @public
 */
export const layer = (
  ...policies: ReadonlyArray<Layer.Layer<never>>
): Layer.Layer<never> =>
  policies.length === 0
    ? Layer.empty
    : policies.length === 1
      ? policies[0]!
      : Layer.mergeAll(policies[0]!, policies[1]!, ...policies.slice(2));

// =============================================================================
// Typed make / merge (Policy is already a Layer)
// =============================================================================

/**
 * Object form for {@link make} / {@link merge}. Keys match Context references
 * (PascalCase); omitted keys leave ambient defaults alone.
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
 * Patch `Prev` with `Patch` — patch keys win; others keep `Prev`.
 *
 * @category models
 * @public
 */
export type MergeConfigs<Prev extends Config, Patch extends Config> = {
  readonly [K in keyof Prev | keyof Patch]: K extends keyof Patch
    ? Patch[K]
    : K extends keyof Prev
      ? Prev[K]
      : never;
};

/**
 * A policy bundle that **is** a `Layer.Layer<never>` — use anywhere a Layer goes
 * (`Effect.provide`, `Layer.provide`, {@link provide}) without wrapping. The type
 * parameter records which modes were set (for hover / docs / pipe merges).
 *
 * ```ts
 * const cutover: Policy.Policy<{
 *   StreamGap: "stall"
 *   ColdAmbiguous: "fail"
 *   Verify: "reject"
 * }> = Policy.make({
 *   StreamGap: "stall",
 *   ColdAmbiguous: "fail",
 *   Verify: "reject",
 * })
 * ```
 *
 * @category models
 * @public
 */
export interface Policy<out C extends Config = Config>
  extends Layer.Layer<never>
{
  readonly [TypeId]: C;
}

/**
 * Build a typed {@link Policy} from an object. Already a Layer — pipe
 * {@link merge} to swap / add keys; pass to {@link provide} as-is.
 *
 * ```ts
 * const cutover = Policy.make({
 *   Sticky: true,
 *   StreamGap: "stall",
 *   ColdAmbiguous: "fail",
 *   Verify: "reject",
 * })
 *
 * Hyperlink.lookupClient(Mail).pipe(
 *   Policy.provide(cutover),
 *   Layer.provide(Lookup.layer),
 * )
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
    parts.push(streamGap(config.StreamGap));
  }
  if (config.ColdAmbiguous !== undefined) {
    parts.push(coldAmbiguous(config.ColdAmbiguous));
  }
  if (config.Pick !== undefined) {
    parts.push(pick(config.Pick));
  }
  if (config.Verify !== undefined) {
    parts.push(verify(config.Verify));
  }
  if (config.Conflict !== undefined) {
    parts.push(onConflict(config.Conflict));
  }
  if (config.Yield !== undefined) {
    const handler =
      typeof config.Yield === "boolean"
        ? Effect.succeed(config.Yield)
        : config.Yield;
    parts.push(onYield(handler));
  }
  return (
    parts.length === 0 ? Layer.empty : layer(...parts)
  ) as Policy<C>;
};

/**
 * Pipeable patch — swap or add modes onto a {@link Policy} (or any policy Layer).
 * Last write wins per reference; the returned type merges configs.
 *
 * ```ts
 * const cutover = Policy.make({ StreamGap: "stall", Verify: "reject" })
 * const nested = cutover.pipe(Policy.merge({ Verify: false, StreamGap: "buffer" }))
 * // Policy<{ StreamGap: "buffer"; Verify: false }>
 * ```
 *
 * @category constructors
 * @public
 */
export const merge =
  <const Patch extends Config>(patch: Patch) =>
  <Prev extends Config = Config>(
    self: Policy<Prev> | Layer.Layer<never>,
  ): Policy<MergeConfigs<Prev, Patch>> =>
    layer(self, make(patch)) as Policy<MergeConfigs<Prev, Patch>>;

/**
 * Provide policy fragments onto a Layer (no stacked `Layer.provide`s).
 * Accepts {@link make} bundles, zero-arg fragments, `Policy.layer(...)`, or a
 * mix — last write wins per reference.
 *
 * ```ts
 * Hyperlink.lookupClient(Mail).pipe(
 *   Policy.provide(Policy.make({ Sticky: true, StreamGap: "stall" })),
 *   Layer.provide(Lookup.layer),
 * )
 *
 * const cutover = Policy.layer(Policy.sticky, Policy.verifyOff)
 * client.pipe(Policy.provide(cutover, Policy.streamGap("buffer")))
 * ```
 *
 * @category layers
 * @public
 */
export const provide =
  (...policies: ReadonlyArray<Layer.Layer<never>>) =>
  <A, E, R>(self: Layer.Layer<A, E, R>): Layer.Layer<A, E, R> =>
    policies.length === 0 ? self : self.pipe(Layer.provide(layer(...policies)));

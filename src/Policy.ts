/**
 * Policy — composable client cutover / dial behaviour for {@link Hyperlink.lookupClient}.
 *
 * Fragments are thin {@link Layer}s (Context references with defaults). Pipe them with
 * {@link provide} / {@link layer} — not stamped on Node / Lookup / Prototype.
 *
 * Defaults (when you provide nothing): sticky on, stream gap `"stall"`, cold ambiguous
 * `"fail"`.
 *
 * ```ts
 * import * as Policy from "hyperlink-ts/Policy"
 *
 * Hyperlink.lookupClient(Mail).pipe(
 *   Policy.provide(
 *     Policy.sticky,
 *     Policy.streamGap("stall"),
 *     Policy.coldAmbiguous("fail"),
 *   ),
 *   Layer.provide(Lookup.layer),
 * )
 *
 * const cutover = Policy.layer(
 *   Policy.sticky,
 *   Policy.streamGap("stall"),
 * )
 * ```
 *
 * @module Policy
 */
import { Context, Layer } from "effect";
import type { DirectoryEntry } from "./Directory";

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
 * How a live client {@link Stream} behaves across a dial swap / transport gap.
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

// =============================================================================
// Context references (defaults = lean cutover)
// =============================================================================

/**
 * Warm dual-serve stickiness — keep current `nodeKey` while it remains Directory-visible
 * and Advice has not preferred another row. Default `true`.
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
export const StreamGap: Context.Reference<StreamGap> = Context.Reference<StreamGap>(
  "hyperlink-ts/Policy/StreamGap",
  { defaultValue: (): StreamGap => "stall" },
);

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

// =============================================================================
// Fragments
// =============================================================================

/**
 * Keep the current dial across dual-serve (default on — provide to be explicit).
 *
 * @category layers
 * @public
 */
export const sticky: Layer.Layer<never> = Layer.succeed(Sticky, true);

/**
 * Disable warm stickiness — re-resolve on every membership change.
 *
 * @category layers
 * @public
 */
export const unsticky: Layer.Layer<never> = Layer.succeed(Sticky, false);

/**
 * Stream seam mode for live streams / `ref.changes` across dial swap.
 *
 * @category layers
 * @public
 */
export const streamGap = (mode: StreamGap): Layer.Layer<never> =>
  Layer.succeed(StreamGap, mode);

/**
 * Cold N&gt;1 behaviour when Advice does not resolve a row.
 *
 * @category layers
 * @public
 */
export const coldAmbiguous = (mode: ColdAmbiguous): Layer.Layer<never> =>
  Layer.succeed(ColdAmbiguous, mode);

/**
 * Soft pick when N&gt;1 and Advice misses (before {@link coldAmbiguous}).
 *
 * @category layers
 * @public
 */
export const pick = (mode: Pick): Layer.Layer<never> =>
  Layer.succeed(Pick, mode);

// =============================================================================
// Helpers
// =============================================================================

/**
 * Merge policy fragments into one Layer (last write wins per reference).
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

/**
 * Provide policy fragments onto a client Layer (no stacked `Layer.provide`s).
 *
 * ```ts
 * Hyperlink.lookupClient(Mail).pipe(
 *   Policy.provide(Policy.sticky, Policy.streamGap("stall")),
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
    policies.length === 0 ? self : self.pipe(Layer.provide(layer(...policies)));

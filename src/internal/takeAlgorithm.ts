/**
 * Built-in and custom take algorithms for {@link LaneStore} `poll`.
 *
 * @internal
 */

/** Built-in take algorithms shipped by the package. @internal */
export type BuiltInTakeAlgorithm = "priority" | "strict-descending" | "weighted";

/**
 * Context passed to a custom take algorithm on each `poll`.
 *
 * @internal
 */
export interface TakeAlgorithmPickContext {
  /** Non-empty levels with their current queue depth. */
  readonly nonEmpty: ReadonlyArray<{
    readonly level: number;
    readonly size: number;
  }>;
  /** Opaque scheduler state from the prior pick (undefined on first pick). */
  readonly state: unknown;
}

/**
 * Result of a custom take pick — which level to dequeue from and updated state.
 *
 * @internal
 */
export interface TakeAlgorithmPick {
  readonly level: number;
  readonly nextState: unknown;
}

/** User-supplied take algorithm (config hook). @internal */
export type CustomTakeAlgorithm = (
  ctx: TakeAlgorithmPickContext,
) => TakeAlgorithmPick | undefined;

/** Config value: built-in name or custom pick function. @internal */
export type TakeAlgorithm = BuiltInTakeAlgorithm | CustomTakeAlgorithm;

/** @internal */
export const isBuiltInTakeAlgorithm = (
  value: TakeAlgorithm,
): value is BuiltInTakeAlgorithm => typeof value === "string";

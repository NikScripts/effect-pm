/**
 * The Polling service interface + its Context tag. INTERNAL on purpose: polling is cadence
 * policy for processes — neither a resource nor a process — so the public `Polling` namespace
 * exposes verbs (`layer`, `current`) and presets instead of a tag. The tag type still appears
 * in R positions of public signatures (the supervisor is the only provider).
 *
 * @module internal/pollingTag
 */

import { Context, Duration, Effect, Option } from "effect";

/**
 * Cadence policy used by the Daemon supervisor between ticks while armed.
 * Implement this and wrap it with `Polling.layer` for a custom cadence.
 *
 * @category models
 * @public
 */
export interface PollingService {
  /** Wait until the next poll attempt (races internal wake deferred). */
  readonly awaitNextTick: Effect.Effect<void>;
  /** End the current wait early so cadence recomputes immediately. */
  readonly requestWake: Effect.Effect<void>;
  /** Preset-specific reset (iteration for accelerating, wake for spaced). */
  readonly resetCadence: Effect.Effect<void>;
  /** Run after each successful user effect completion (e.g., increment iteration). */
  readonly afterTick: Effect.Effect<void>;
  /** Best-effort cadence hint for status UIs (none if unknown). */
  readonly peekCadence: Effect.Effect<Option.Option<Duration.Duration>>;
}

/** Context tag for the Polling service — provided by the Daemon supervisor. @internal */
export class PollingTag extends Context.Service<PollingTag, PollingService>()(
  "hyperlink-ts/internal/pollingTag",
) {}

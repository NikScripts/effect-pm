/**
 * **Polling** — cadence between repeats of a running {@link Process} instance
 * while the {@link ProcessSchedule} gate remains armed.
 *
 * Configure with {@link Polling.spaced}, {@link Polling.accelerating}, or a
 * custom {@link Layer.Layer} built with {@link Layer.succeed}(`Polling`, implementation).
 *
 * @remarks
 * Phase-0 defaults (see `docs/plans/09-process-v2-effect-first.md`):
 * - **Overlap:** `serial` only in shipped presets (one tick at a time).
 * - **resetCadence:** For {@link Polling.accelerating}, zeros the iteration counter
 *   and {@link Polling.requestWake | wakes} the current wait. For {@link Polling.spaced},
 *   equivalent to {@link Polling.requestWake}.
 *
 * @module Polling
 */

import { Context, Duration, Effect, Layer, Ref, Deferred, Option, pipe } from "effect";

// ============================================================================
// Service
// ============================================================================

/**
 * Cadence policy used by the {@link Process} supervisor between ticks while armed.
 *
 * @remarks
 * - {@link awaitNextTick} — wait until the next poll attempt (races internal wake).
 * - {@link requestWake} — end the current wait early so cadence recomputes.
 * - {@link resetCadence} — preset-specific reset (iteration for accelerating).
 * - {@link afterTick} — run after each successful user `effect` completion.
 *
 * @public
 */
export interface PollingService {
  /** Only `serial` is used by current presets (mutex between ticks). */
  readonly overlap: "serial" | "concurrent";
  readonly awaitNextTick: Effect.Effect<void>;
  readonly requestWake: Effect.Effect<void>;
  readonly resetCadence: Effect.Effect<void>;
  readonly afterTick: Effect.Effect<void>;
  /**
   * Best-effort hint for {@link Process.getStatus} (none if unknown).
   * Presets populate this; custom layers may omit (`Effect.succeed(Option.none())`).
   */
  readonly peekCadence: Effect.Effect<Option.Option<Duration.Duration>>;
}

export class PollingTag extends Context.Service<PollingTag, PollingService>()(
  "@nikscripts/effect-pm/Polling/PollingTag",
) {}

// ============================================================================
// Internal: wakeable sleep
// ============================================================================

interface WakeableAwait {
  readonly awaitNextTick: Effect.Effect<void, never, never>;
  readonly requestWake: Effect.Effect<void, never, never>;
}

const makeWakeableAwait = (
  duration: Duration.Duration,
): Effect.Effect<WakeableAwait, never, never> =>
  Effect.gen(function* () {
    const wakeDeferred = yield* Ref.make<Deferred.Deferred<void, never>>(
      yield* Deferred.make<void>(),
    );

    const awaitNextTick: Effect.Effect<void, never, never> = Effect.gen(function* () {
      const d = yield* Deferred.make<void>();
      yield* Ref.set(wakeDeferred, d);
      yield* Effect.race(Effect.sleep(duration), Deferred.await(d)).pipe(Effect.asVoid);
    });

    const requestWake = Effect.gen(function* () {
      const d = yield* Ref.get(wakeDeferred);
      yield* Deferred.succeed(d, undefined);
    });

    return { awaitNextTick, requestWake } as const;
  });

// ============================================================================
// Presets
// ============================================================================

const spacedLayer = (
  duration: Duration.Duration,
): Layer.Layer<PollingTag, never, never> =>
  Layer.effect(
    PollingTag,
    Effect.gen(function* () {
      const { awaitNextTick, requestWake } = yield* makeWakeableAwait(duration);
      const impl: PollingService = {
        overlap: "serial",
        awaitNextTick,
        requestWake,
        resetCadence: requestWake,
        afterTick: Effect.void,
        peekCadence: Effect.succeed(Option.some(duration)),
      };
      return impl;
    }),
  );

/**
 * Live configuration for {@link accelerating}.
 *
 * @public
 */
export interface AcceleratingPollConfig {
  /** Lower bound of delay (ms). */
  readonly minIntervalMs: number;
  /** Upper bound of delay (ms) at iteration zero. */
  readonly maxIntervalMs: number;
  /** Decay constant `k` in `delay(n) = min + (max-min) * e^(-k * n * excitement)`. */
  readonly decayK: number;
}

const clampPositive = (n: number): number => (n > 0 ? n : 0);

const delayMsForIteration = (
  cfg: AcceleratingPollConfig,
  n: number,
  excitement: number,
): number => {
  const minMs = clampPositive(cfg.minIntervalMs);
  const maxMs = Math.max(minMs, cfg.maxIntervalMs);
  const span = maxMs - minMs;
  const k = cfg.decayK;
  const exc = excitement > 0 ? excitement : 1;
  const t = Math.exp(-k * n * exc);
  return minMs + span * t;
};

/**
 * Exponentially accelerating poll cadence (see plan 09).
 *
 * @remarks
 * Exposes refs so other effects (or HTTP handlers) can tune live parameters or
 * reset the curve. {@link resetCadence} sets iteration to `0` and wakes the
 * current wait.
 *
 * @public
 */
const acceleratingLayer = (options: {
  readonly config: Ref.Ref<AcceleratingPollConfig>;
  readonly iteration: Ref.Ref<number>;
  readonly excitement: Ref.Ref<number>;
}): Layer.Layer<PollingTag, never, never> =>
  Layer.effect(
    PollingTag,
    Effect.gen(function* () {
      const { config: configRef, iteration: iterationRef, excitement: excRef } =
        options;

      const wakeDeferred = yield* Ref.make<Deferred.Deferred<void, never>>(
        yield* Deferred.make<void>(),
      );

      const requestWake = Effect.gen(function* () {
        const d = yield* Ref.get(wakeDeferred);
        yield* Deferred.succeed(d, undefined);
      });

      const awaitNextTick: Effect.Effect<void, never, never> = Effect.gen(function* () {
        const d = yield* Deferred.make<void>();
        yield* Ref.set(wakeDeferred, d);
        const n = yield* Ref.get(iterationRef);
        const cfg = yield* Ref.get(configRef);
        const excitement = yield* Ref.get(excRef);
        const ms = delayMsForIteration(cfg, n, excitement);
        const dur = Duration.millis(ms);
        yield* Effect.race(Effect.sleep(dur), Deferred.await(d)).pipe(Effect.asVoid);
      });

      const resetCadence = Effect.gen(function* () {
        yield* Ref.set(iterationRef, 0);
        yield* requestWake;
      });

      const afterTick = pipe(
        Ref.update(iterationRef, (n) => n + 1),
        Effect.asVoid,
      );

      const peekCadence = Effect.gen(function* () {
        const n = yield* Ref.get(iterationRef);
        const cfg = yield* Ref.get(configRef);
        const excitement = yield* Ref.get(excRef);
        const ms = delayMsForIteration(cfg, n, excitement);
        return Option.some(Duration.millis(ms));
      });

      const impl: PollingService = {
        overlap: "serial",
        awaitNextTick,
        requestWake,
        resetCadence,
        afterTick,
        peekCadence,
      };

      return impl;
    }),
  );

/**
 * Allocate refs and build {@link accelerating} in one step (refs scoped to the layer build).
 *
 * @public
 */
const acceleratingScopedLayer = (
  initial: AcceleratingPollConfig,
): Layer.Layer<PollingTag, never, never> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const config = yield* Ref.make(initial);
      const iteration = yield* Ref.make(0);
      const excitement = yield* Ref.make(1);
      return acceleratingLayer({ config, iteration, excitement });
    }),
  );

/**
 * Context tag for {@link PollingService}, plus preset cadence layers.
 *
 * @remarks
 * - **`spaced`** — fixed delay between ticks (wakeable).
 * - **`accelerating`** — shared refs; usually prefer **`acceleratingScoped`** for isolation.
 * - **`acceleratingScoped`** — `Layer.unwrap` so each scope gets its own refs.
 *
 * @public
 */
export const Polling: typeof PollingTag & {
  readonly spaced: typeof spacedLayer;
  readonly accelerating: typeof acceleratingLayer;
  readonly acceleratingScoped: typeof acceleratingScopedLayer;
} = Object.assign(PollingTag, {
  spaced: spacedLayer,
  accelerating: acceleratingLayer,
  acceleratingScoped: acceleratingScopedLayer,
});

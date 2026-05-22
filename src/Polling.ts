/**
 * Polling — cadence between repeats of a running Process instance.
 *
 * Controls how often the user's effect is executed while the schedule gate
 * remains armed. Presets provide common patterns; custom implementations
 * can be built by providing a `PollingService` via `Layer.succeed(Polling, impl)`.
 *
 * ## Presets
 *
 * | Preset | Behavior |
 * |--------|----------|
 * | `Polling.spaced` | Fixed interval between ticks (wakeable) |
 * | `Polling.jittered` | Fixed interval ± random jitter (prevents thundering herd) |
 * | `Polling.backoff` | Exponential backoff: initial → max (resetCadence resets) |
 * | `Polling.accelerating` | Exponential decay: starts slow, speeds up with excitement |
 * | `Polling.acceleratingWithRefs` | Accelerating cadence with externally-owned refs |
 *
 * ## Usage
 *
 * ```ts
 * import { Duration } from "effect"
 * import { Process, Polling, ProcessSchedule } from "@nikscripts/effect-pm"
 *
 * const myProcess = Process.make("heartbeat", {
 *   polling: Polling.spaced("10 seconds"),
 *   schedule: ProcessSchedule.alwaysArmed,
 *   effect: Effect.logInfo("tick"),
 * })
 * ```
 *
 * @module Polling
 */

import { Context, Duration, Effect, Layer, Option, Random, Ref, Deferred } from "effect";
import { registerPollingLayer } from "./processLayerBrand.js";

// ============================================================================
// Service interface
// ============================================================================

/**
 * Cadence policy used by the Process supervisor between ticks while armed.
 *
 * @public
 */
export interface PollingService {
  /** Only `serial` is used by current presets (mutex between ticks). */
  readonly overlap: "serial" | "concurrent";
  /** Wait until the next poll attempt (races internal wake deferred). */
  readonly awaitNextTick: Effect.Effect<void>;
  /** End the current wait early so cadence recomputes immediately. */
  readonly requestWake: Effect.Effect<void>;
  /** Preset-specific reset (iteration for accelerating, wake for spaced). */
  readonly resetCadence: Effect.Effect<void>;
  /** Run after each successful user effect completion (e.g., increment iteration). */
  readonly afterTick: Effect.Effect<void>;
  /** Best-effort hint for Process.getStatus (none if unknown). */
  readonly peekCadence: Effect.Effect<Option.Option<Duration.Duration>>;
}

/**
 * Context tag for the Polling service.
 *
 * @public
 */
export class PollingTag extends Context.Service<PollingTag, PollingService>()(
  "@nikscripts/effect-pm/Polling/PollingTag",
) {}

// ============================================================================
// Internal: wakeable sleep (Deferred-based interruptible timer)
// ============================================================================

interface WakeableAwait {
  readonly awaitNextTick: Effect.Effect<void>;
  readonly requestWake: Effect.Effect<void>;
}

/**
 * Allocate a wakeable timer: sleeps for `duration` but can be interrupted
 * early via `requestWake` (completes the internal Deferred).
 */
const makeWakeableAwait = (duration: Duration.Duration) =>
  Effect.map(
    // Each tick cycle gets a fresh Deferred; wake completes the current one
    Ref.make<Deferred.Deferred<void, never>>(Deferred.makeUnsafe()),
    (wakeRef): WakeableAwait => ({
      awaitNextTick: Effect.gen(function* () {
        const d = Deferred.makeUnsafe<void, never>();
        yield* Ref.set(wakeRef, d);
        // Race: either the sleep completes naturally, or wake fires
        yield* Effect.race(Effect.sleep(duration), Deferred.await(d)).pipe(Effect.asVoid);
      }),
      requestWake: Effect.flatMap(Ref.get(wakeRef), (d) => Deferred.succeed(d, undefined)).pipe(
        Effect.asVoid,
      ),
    }),
  );

// ============================================================================
// Preset: spaced (fixed interval)
// ============================================================================

/**
 * Fixed interval between ticks. `resetCadence` wakes the current wait immediately.
 *
 * @example
 * ```ts
 * Polling.spaced("30 seconds")
 * Polling.spaced(Duration.minutes(1))
 * ```
 */
const spacedLayer = (
  interval: Duration.Input,
): Layer.Layer<PollingTag> => {
  const dur = Duration.fromInputUnsafe(interval);
  return registerPollingLayer(
    Layer.effect(
      PollingTag,
      Effect.map(makeWakeableAwait(dur), ({ awaitNextTick, requestWake }): PollingService => ({
        overlap: "serial",
        awaitNextTick,
        requestWake,
        resetCadence: requestWake,
        afterTick: Effect.void,
        peekCadence: Effect.succeed(Option.some(dur)),
      })),
    ),
  );
};

// ============================================================================
// Preset: jittered (fixed interval ± random jitter)
// ============================================================================

/**
 * Fixed interval with random jitter to prevent thundering herd.
 * Each tick varies by ±`jitter` fraction of the base interval.
 *
 * @example
 * ```ts
 * Polling.jittered("5 seconds", { jitter: 0.2 })
 * // Each tick: 5s ± 20% → between 4s and 6s
 * ```
 */
const jitteredLayer = (
  interval: Duration.Input,
  options: { readonly jitter: number } = { jitter: 0.1 },
): Layer.Layer<PollingTag> => {
  const baseMs = Duration.toMillis(Duration.fromInputUnsafe(interval));
  const jitterFraction = Math.abs(options.jitter);

  return registerPollingLayer(
    Layer.effect(
      PollingTag,
      Effect.gen(function* () {
        const wakeRef = yield* Ref.make<Deferred.Deferred<void, never>>(Deferred.makeUnsafe());

        const awaitNextTick: Effect.Effect<void> = Effect.gen(function* () {
          const d = Deferred.makeUnsafe<void, never>();
          yield* Ref.set(wakeRef, d);
          // Random offset: base +/- jitter%.
        const random = yield* Random.next;
        const offset = (random * 2 - 1) * jitterFraction * baseMs;
        const ms = Math.max(0, baseMs + offset);
        yield* Effect.race(Effect.sleep(Duration.millis(ms)), Deferred.await(d)).pipe(Effect.asVoid);
      });

      const requestWake = Effect.flatMap(Ref.get(wakeRef), (d) => Deferred.succeed(d, undefined)).pipe(
        Effect.asVoid,
      );

      return {
        overlap: "serial",
        awaitNextTick,
        requestWake,
        resetCadence: requestWake,
        afterTick: Effect.void,
        peekCadence: Effect.succeed(Option.some(Duration.fromInputUnsafe(interval))),
        } satisfies PollingService;
      }),
    ),
  );
};

// ============================================================================
// Preset: backoff (exponential backoff with cap)
// ============================================================================

/**
 * Exponential backoff: starts at `initial`, doubles (or multiplies by `factor`)
 * each tick, caps at `max`. `resetCadence` resets to `initial`.
 *
 * @example
 * ```ts
 * Polling.backoff({ initial: "1 second", max: "30 seconds", factor: 2 })
 * // 1s → 2s → 4s → 8s → 16s → 30s → 30s → ...
 * // resetCadence → back to 1s
 * ```
 */
const backoffLayer = (options: {
  readonly initial: Duration.Input;
  readonly max: Duration.Input;
  readonly factor?: number;
}): Layer.Layer<PollingTag> => {
  const initialMs = Duration.toMillis(Duration.fromInputUnsafe(options.initial));
  const maxMs = Duration.toMillis(Duration.fromInputUnsafe(options.max));
  const factor = options.factor ?? 2;

  return registerPollingLayer(
    Layer.effect(
      PollingTag,
      Effect.gen(function* () {
        const currentMs = yield* Ref.make(initialMs);
        const wakeRef = yield* Ref.make<Deferred.Deferred<void, never>>(Deferred.makeUnsafe());

        const awaitNextTick: Effect.Effect<void> = Effect.gen(function* () {
          const d = Deferred.makeUnsafe<void, never>();
          yield* Ref.set(wakeRef, d);
          const ms = yield* Ref.get(currentMs);
        yield* Effect.race(Effect.sleep(Duration.millis(ms)), Deferred.await(d)).pipe(Effect.asVoid);
      });

      const requestWake = Effect.flatMap(Ref.get(wakeRef), (d) => Deferred.succeed(d, undefined)).pipe(
        Effect.asVoid,
      );

      const afterTick = Ref.update(currentMs, (ms) => Math.min(ms * factor, maxMs));

      const resetCadence = Ref.set(currentMs, initialMs).pipe(
        Effect.andThen(requestWake),
      );

      const peekCadence = Effect.map(Ref.get(currentMs), (ms) => Option.some(Duration.millis(ms)));

      return {
        overlap: "serial",
        awaitNextTick,
        requestWake,
        resetCadence,
        afterTick,
        peekCadence,
        } satisfies PollingService;
      }),
    ),
  );
};

// ============================================================================
// Preset: accelerating (exponential decay curve)
// ============================================================================

/**
 * Configuration for the accelerating preset.
 *
 * @example
 * ```ts
 * Polling.accelerating({
 *   fastest: "500 millis",   // lower bound (at high iteration)
 *   slowest: "30 seconds",   // upper bound (at iteration 0)
 *   decay: 0.5,              // faster decay = quicker acceleration
 *   excitement: 2,           // multiplier for the decay (tune live)
 * })
 * ```
 *
 * @public
 */
export interface AcceleratingPollConfig {
  /** Fastest possible interval (lower bound). */
  readonly fastest: Duration.Input;
  /** Slowest interval at iteration zero (upper bound). */
  readonly slowest: Duration.Input;
  /** Decay constant: higher = faster acceleration. @default 0.3 */
  readonly decay?: number;
  /** Excitement multiplier: higher = speeds up faster. @default 1 */
  readonly excitement?: number;
}

/**
 * Compute delay for a given iteration using exponential decay:
 * `delay(n) = fastest + (slowest - fastest) * e^(-decay * n * excitement)`
 */
const delayMsForIteration = (
  fastestMs: number,
  slowestMs: number,
  decay: number,
  excitement: number,
  iteration: number,
): number => {
  const span = slowestMs - fastestMs;
  const t = Math.exp(-decay * iteration * excitement);
  return fastestMs + span * t;
};

/**
 * Exponentially accelerating poll cadence. Starts slow (at `slowest`), speeds up
 * toward `fastest` as iterations increase. `resetCadence` resets to iteration 0.
 *
 * @example
 * ```ts
 * Polling.accelerating({
 *   fastest: "1 second",
 *   slowest: "1 minute",
 *   decay: 0.3,
 *   excitement: 1,
 * })
 * ```
 */
const acceleratingLayer = (config: AcceleratingPollConfig): Layer.Layer<PollingTag> => {
  const fastestMs = Duration.toMillis(Duration.fromInputUnsafe(config.fastest));
  const slowestMs = Math.max(fastestMs, Duration.toMillis(Duration.fromInputUnsafe(config.slowest)));
  const decay = config.decay ?? 0.3;
  const excitement = config.excitement ?? 1;

  return registerPollingLayer(
    Layer.effect(
      PollingTag,
      Effect.gen(function* () {
        const iterationRef = yield* Ref.make(0);
        const wakeRef = yield* Ref.make<Deferred.Deferred<void, never>>(Deferred.makeUnsafe());

        const awaitNextTick: Effect.Effect<void> = Effect.gen(function* () {
          const d = Deferred.makeUnsafe<void, never>();
          yield* Ref.set(wakeRef, d);
          const n = yield* Ref.get(iterationRef);
          const ms = delayMsForIteration(fastestMs, slowestMs, decay, excitement, n);
        yield* Effect.race(Effect.sleep(Duration.millis(ms)), Deferred.await(d)).pipe(Effect.asVoid);
      });

      const requestWake = Effect.flatMap(Ref.get(wakeRef), (d) => Deferred.succeed(d, undefined)).pipe(
        Effect.asVoid,
      );

      const resetCadence = Ref.set(iterationRef, 0).pipe(Effect.andThen(requestWake));
      const afterTick = Ref.update(iterationRef, (n) => n + 1);

      const peekCadence = Effect.map(Ref.get(iterationRef), (n) =>
        Option.some(Duration.millis(delayMsForIteration(fastestMs, slowestMs, decay, excitement, n))),
      );

      return {
        overlap: "serial",
        awaitNextTick,
        requestWake,
        resetCadence,
        afterTick,
        peekCadence,
        } satisfies PollingService;
      }),
    ),
  );
};

/**
 * Accelerating cadence with externally-managed refs for live tuning.
 * Prefer {@link accelerating} unless you need runtime parameter changes via refs.
 *
 * @public
 */
const acceleratingWithRefs = (options: {
  readonly config: Ref.Ref<{ minIntervalMs: number; maxIntervalMs: number; decayK: number }>;
  readonly iteration: Ref.Ref<number>;
  readonly excitement: Ref.Ref<number>;
}): Layer.Layer<PollingTag> =>
  registerPollingLayer(
    Layer.effect(
      PollingTag,
      Effect.gen(function* () {
        const { config: configRef, iteration: iterationRef, excitement: excRef } = options;
      const wakeRef = yield* Ref.make<Deferred.Deferred<void, never>>(Deferred.makeUnsafe());

      const requestWake = Effect.flatMap(Ref.get(wakeRef), (d) => Deferred.succeed(d, undefined)).pipe(
        Effect.asVoid,
      );

      const awaitNextTick: Effect.Effect<void> = Effect.gen(function* () {
        const d = Deferred.makeUnsafe<void, never>();
        yield* Ref.set(wakeRef, d);
        const n = yield* Ref.get(iterationRef);
        const cfg = yield* Ref.get(configRef);
        const exc = yield* Ref.get(excRef);
        const ms = delayMsForIteration(cfg.minIntervalMs, cfg.maxIntervalMs, cfg.decayK, exc, n);
        yield* Effect.race(Effect.sleep(Duration.millis(ms)), Deferred.await(d)).pipe(Effect.asVoid);
      });

      const resetCadence = Ref.set(iterationRef, 0).pipe(Effect.andThen(requestWake));
      const afterTick = Ref.update(iterationRef, (n) => n + 1);

      const peekCadence = Effect.gen(function* () {
        const n = yield* Ref.get(iterationRef);
        const cfg = yield* Ref.get(configRef);
        const exc = yield* Ref.get(excRef);
        return Option.some(Duration.millis(delayMsForIteration(cfg.minIntervalMs, cfg.maxIntervalMs, cfg.decayK, exc, n)));
      });

        return { overlap: "serial", awaitNextTick, requestWake, resetCadence, afterTick, peekCadence } satisfies PollingService;
      }),
    ),
  );

// ============================================================================
// Public API
// ============================================================================

/**
 * Polling — cadence presets and Context tag.
 *
 * @public
 */
export const Polling: typeof PollingTag & {
  readonly spaced: typeof spacedLayer;
  readonly jittered: typeof jitteredLayer;
  readonly backoff: typeof backoffLayer;
  readonly accelerating: typeof acceleratingLayer;
  readonly acceleratingWithRefs: typeof acceleratingWithRefs;
} = Object.assign(PollingTag, {
  spaced: spacedLayer,
  jittered: jitteredLayer,
  backoff: backoffLayer,
  accelerating: acceleratingLayer,
  acceleratingWithRefs,
});

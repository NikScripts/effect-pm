/**
 * Polling — cadence between repeats of a running Daemon instance.
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
 * | `Polling.adaptive` | Fast after a work signal, decays toward an idle cap |
 * | `Polling.dynamic` | Cadence from a DynamicConfig field; wakes on swap |
 * | `Polling.cron` | Ticks on cron-expression occurrences (calendar-aligned) |
 *
 * ## Usage
 *
 * ```ts
 * import { Duration } from "effect"
 * import { Daemon, Polling, DaemonSchedule } from "hyperlink-ts"
 *
 * const myDaemon = Daemon.make("heartbeat", {
 *   polling: Polling.spaced("10 seconds"),
 *   schedule: DaemonSchedule.alwaysArmed,
 *   effect: Effect.logInfo("tick"),
 * })
 * ```
 *
 * @module Polling
 */

import {
  Clock,
  Cron,
  DateTime,
  Duration,
  Effect,
  Layer,
  Option,
  Random,
  Ref,
  Deferred,
  Scope,
  Stream,
} from "effect";
import { registerPollingLayer } from "./internal/daemonLayerBrand";
import {
  DynamicConfigStore,
  type FixedField,
  type SwappableField,
} from "./DynamicConfig";

// ============================================================================
// Service interface
// ============================================================================

// The Service interface + Context tag live in internal/pollingTag — the tag is not part of
// the public namespace (polling is not a resource; a `Tag` member would suggest the contract
// factory it isn't). `layer` and `current` below are the public verbs over it.
import { PollingTag, type PollingService } from "./internal/pollingTag";

export type { PollingService as Service } from "./internal/pollingTag";

/**
 * The polling service of the CURRENT daemon tick context — yield inside a daemon
 * effect to wake, reset, or peek the cadence. Provided by the supervisor.
 *
 * @category context
 * @public
 */
export const current: Effect.Effect<PollingService, never, PollingTag> =
  PollingTag;

/**
 * A custom cadence policy as a polling layer for `Daemon.make({ polling })`.
 * Replaces the old `Layer.succeed(Polling, impl)` form; the tag stays internal.
 *
 * @category constructors
 * @public
 */
export const layer = (impl: PollingService): Layer.Layer<PollingTag> =>
  registerPollingLayer(Layer.succeed(PollingTag, impl));

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
        yield* Effect.race(Effect.sleep(duration), Deferred.await(d)).pipe(
          Effect.asVoid
        );
      }),
      requestWake: Effect.flatMap(Ref.get(wakeRef), (d) =>
        Deferred.succeed(d, undefined)
      ).pipe(Effect.asVoid),
    })
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
 * @category presets
 * @public
 */
export const spaced = (interval: Duration.Input): Layer.Layer<PollingTag> => {
  const dur = Duration.fromInputUnsafe(interval);
  return registerPollingLayer(
    Layer.effect(
      PollingTag,
      Effect.map(
        makeWakeableAwait(dur),
        ({ awaitNextTick, requestWake }): PollingService => ({
          awaitNextTick,
          requestWake,
          resetCadence: requestWake,
          afterTick: Effect.void,
          peekCadence: Effect.succeed(Option.some(dur)),
        })
      )
    )
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
 * @category presets
 * @public
 */
export const jittered = (
  interval: Duration.Input,
  options: { readonly jitter: number } = { jitter: 0.1 }
): Layer.Layer<PollingTag> => {
  const baseMs = Duration.toMillis(Duration.fromInputUnsafe(interval));
  const jitterFraction = Math.abs(options.jitter);

  return registerPollingLayer(
    Layer.effect(
      PollingTag,
      Effect.gen(function* () {
        const wakeRef = yield* Ref.make<Deferred.Deferred<void, never>>(
          Deferred.makeUnsafe()
        );

        const awaitNextTick: Effect.Effect<void> = Effect.gen(function* () {
          const d = Deferred.makeUnsafe<void, never>();
          yield* Ref.set(wakeRef, d);
          // Random offset: base +/- jitter%.
          const random = yield* Random.next;
          const offset = (random * 2 - 1) * jitterFraction * baseMs;
          const ms = Math.max(0, baseMs + offset);
          yield* Effect.race(
            Effect.sleep(Duration.millis(ms)),
            Deferred.await(d)
          ).pipe(Effect.asVoid);
        });

        const requestWake = Effect.flatMap(Ref.get(wakeRef), (d) =>
          Deferred.succeed(d, undefined)
        ).pipe(Effect.asVoid);

        return {
          awaitNextTick,
          requestWake,
          resetCadence: requestWake,
          afterTick: Effect.void,
          peekCadence: Effect.succeed(
            Option.some(Duration.fromInputUnsafe(interval))
          ),
        } satisfies PollingService;
      })
    )
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
 * @category presets
 * @public
 */
export const backoff = (options: {
  readonly initial: Duration.Input;
  readonly max: Duration.Input;
  readonly factor?: number;
}): Layer.Layer<PollingTag> => {
  const initialMs = Duration.toMillis(
    Duration.fromInputUnsafe(options.initial)
  );
  const maxMs = Duration.toMillis(Duration.fromInputUnsafe(options.max));
  const factor = options.factor ?? 2;

  return registerPollingLayer(
    Layer.effect(
      PollingTag,
      Effect.gen(function* () {
        const currentMs = yield* Ref.make(initialMs);
        const wakeRef = yield* Ref.make<Deferred.Deferred<void, never>>(
          Deferred.makeUnsafe()
        );

        const awaitNextTick: Effect.Effect<void> = Effect.gen(function* () {
          const d = Deferred.makeUnsafe<void, never>();
          yield* Ref.set(wakeRef, d);
          const ms = yield* Ref.get(currentMs);
          yield* Effect.race(
            Effect.sleep(Duration.millis(ms)),
            Deferred.await(d)
          ).pipe(Effect.asVoid);
        });

        const requestWake = Effect.flatMap(Ref.get(wakeRef), (d) =>
          Deferred.succeed(d, undefined)
        ).pipe(Effect.asVoid);

        const afterTick = Ref.update(currentMs, (ms) =>
          Math.min(ms * factor, maxMs)
        );

        const resetCadence = Ref.set(currentMs, initialMs).pipe(
          Effect.andThen(requestWake)
        );

        const peekCadence = Effect.map(Ref.get(currentMs), (ms) =>
          Option.some(Duration.millis(ms))
        );

        return {
          awaitNextTick,
          requestWake,
          resetCadence,
          afterTick,
          peekCadence,
        } satisfies PollingService;
      })
    )
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
 * @category models
 * @public
 */
export interface AcceleratingConfig {
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
  iteration: number
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
 * @category presets
 * @public
 */
export const accelerating = (
  config: AcceleratingConfig
): Layer.Layer<PollingTag> => {
  const fastestMs = Duration.toMillis(Duration.fromInputUnsafe(config.fastest));
  const slowestMs = Math.max(
    fastestMs,
    Duration.toMillis(Duration.fromInputUnsafe(config.slowest))
  );
  const decay = config.decay ?? 0.3;
  const excitement = config.excitement ?? 1;

  return registerPollingLayer(
    Layer.effect(
      PollingTag,
      Effect.gen(function* () {
        const iterationRef = yield* Ref.make(0);
        const wakeRef = yield* Ref.make<Deferred.Deferred<void, never>>(
          Deferred.makeUnsafe()
        );

        const awaitNextTick: Effect.Effect<void> = Effect.gen(function* () {
          const d = Deferred.makeUnsafe<void, never>();
          yield* Ref.set(wakeRef, d);
          const n = yield* Ref.get(iterationRef);
          const ms = delayMsForIteration(
            fastestMs,
            slowestMs,
            decay,
            excitement,
            n
          );
          yield* Effect.race(
            Effect.sleep(Duration.millis(ms)),
            Deferred.await(d)
          ).pipe(Effect.asVoid);
        });

        const requestWake = Effect.flatMap(Ref.get(wakeRef), (d) =>
          Deferred.succeed(d, undefined)
        ).pipe(Effect.asVoid);

        const resetCadence = Ref.set(iterationRef, 0).pipe(
          Effect.andThen(requestWake)
        );
        const afterTick = Ref.update(iterationRef, (n) => n + 1);

        const peekCadence = Effect.map(Ref.get(iterationRef), (n) =>
          Option.some(
            Duration.millis(
              delayMsForIteration(fastestMs, slowestMs, decay, excitement, n)
            )
          )
        );

        return {
          awaitNextTick,
          requestWake,
          resetCadence,
          afterTick,
          peekCadence,
        } satisfies PollingService;
      })
    )
  );
};

/**
 * Accelerating cadence with externally-managed refs for live tuning.
 * Prefer {@link accelerating} unless you need runtime parameter changes via refs.
 *
 * @category presets
 * @public
 */
export const acceleratingWithRefs = (options: {
  readonly config: Ref.Ref<{
    minIntervalMs: number;
    maxIntervalMs: number;
    decayK: number;
  }>;
  readonly iteration: Ref.Ref<number>;
  readonly excitement: Ref.Ref<number>;
}): Layer.Layer<PollingTag> =>
  registerPollingLayer(
    Layer.effect(
      PollingTag,
      Effect.gen(function* () {
        const {
          config: configRef,
          iteration: iterationRef,
          excitement: excRef,
        } = options;
        const wakeRef = yield* Ref.make<Deferred.Deferred<void, never>>(
          Deferred.makeUnsafe()
        );

        const requestWake = Effect.flatMap(Ref.get(wakeRef), (d) =>
          Deferred.succeed(d, undefined)
        ).pipe(Effect.asVoid);

        const awaitNextTick: Effect.Effect<void> = Effect.gen(function* () {
          const d = Deferred.makeUnsafe<void, never>();
          yield* Ref.set(wakeRef, d);
          const n = yield* Ref.get(iterationRef);
          const cfg = yield* Ref.get(configRef);
          const exc = yield* Ref.get(excRef);
          const ms = delayMsForIteration(
            cfg.minIntervalMs,
            cfg.maxIntervalMs,
            cfg.decayK,
            exc,
            n
          );
          yield* Effect.race(
            Effect.sleep(Duration.millis(ms)),
            Deferred.await(d)
          ).pipe(Effect.asVoid);
        });

        const resetCadence = Ref.set(iterationRef, 0).pipe(
          Effect.andThen(requestWake)
        );
        const afterTick = Ref.update(iterationRef, (n) => n + 1);

        const peekCadence = Effect.gen(function* () {
          const n = yield* Ref.get(iterationRef);
          const cfg = yield* Ref.get(configRef);
          const exc = yield* Ref.get(excRef);
          return Option.some(
            Duration.millis(
              delayMsForIteration(
                cfg.minIntervalMs,
                cfg.maxIntervalMs,
                cfg.decayK,
                exc,
                n
              )
            )
          );
        });

        return {
          awaitNextTick,
          requestWake,
          resetCadence,
          afterTick,
          peekCadence,
        } satisfies PollingService;
      })
    )
  );

// ============================================================================
// Public API
// ============================================================================

// ============================================================================
// Preset: dynamic (cadence from a DynamicConfig field)
// ============================================================================

/**
 * Cadence read from a DynamicConfig field on EVERY tick — swap the field's value (locally or
 * over a DaemonManager control verb) and the new interval applies from the next wait. When the
 * field is swappable AND a `DynamicConfigStore` is in context, the current wait also WAKES on
 * swap, so a shorter interval takes effect immediately instead of after the old one elapses
 * (presence-driven, like durability: no store → no subscription, and R stays `never`).
 *
 * Read failures fall back to `options.fallback` when given; otherwise they are defects — a
 * misconfigured cadence should be loud, not a silent default.
 *
 * @example
 * ```ts
 * const pollInterval = DynamicConfig.swappable(Config.duration("POLL_INTERVAL"))
 * Daemon.make("sync", { polling: Polling.dynamic(pollInterval), effect })
 * ```
 * @category presets
 * @public
 */
export const dynamic = (
  field: FixedField<Duration.Duration> | SwappableField<Duration.Duration>,
  options?: { readonly fallback?: Duration.Input }
): Layer.Layer<PollingTag> => {
  const fallback =
    options?.fallback === undefined
      ? undefined
      : Duration.fromInputUnsafe(options.fallback);
  const read: Effect.Effect<Duration.Duration> = Effect.catch(field, (error) =>
    fallback === undefined ? Effect.die(error) : Effect.succeed(fallback)
  );
  return registerPollingLayer(
    Layer.effect(
      PollingTag,
      Effect.gen(function* () {
        const wakeRef = yield* Ref.make<Deferred.Deferred<void, never>>(
          Deferred.makeUnsafe()
        );
        const requestWake = Effect.flatMap(Ref.get(wakeRef), (d) =>
          Deferred.succeed(d, undefined)
        ).pipe(Effect.asVoid);
        const awaitNextTick = Effect.gen(function* () {
          const d = Deferred.makeUnsafe<void, never>();
          yield* Ref.set(wakeRef, d);
          const dur = yield* read;
          yield* Effect.race(Effect.sleep(dur), Deferred.await(d)).pipe(
            Effect.asVoid
          );
        });
        // wake-on-swap: only when the field is swappable and the store is around
        const store = yield* Effect.serviceOption(DynamicConfigStore);
        if ("changes" in field && Option.isSome(store)) {
          yield* Effect.forkScoped(
            Stream.runForEach(field.changes, () => requestWake).pipe(
              Effect.provideService(DynamicConfigStore, store.value)
            )
          );
        }
        return {
          awaitNextTick,
          requestWake,
          resetCadence: requestWake,
          afterTick: Effect.void,
          peekCadence: field.pipe(
            Effect.map(Option.some),
            Effect.catch(() =>
              Effect.succeed(
                fallback === undefined ? Option.none() : Option.some(fallback)
              )
            )
          ),
        } satisfies PollingService;
      })
    )
  );
};

// ============================================================================
// Preset: adaptive (fast on work, decay to idle)
// ============================================================================

/**
 * Work-aware cadence — the complement of {@link backoff}. Ticks run at `active` after a work
 * signal and DECAY toward `idle` (each tick multiplies the wait by `factor`, capped at `idle`)
 * while nothing happens. Signal work by calling `resetCadence` — from inside the effect via
 * {@link current}, from the handle via `daemon.polling.resetCadence`, or wire a stream to it with
 * {@link wakeOn}. The reset snaps the cadence back to `active` and wakes the current wait.
 *
 * The queue-drainer shape: drain fast while entries keep arriving, back off to a lazy idle poll
 * when the queue runs dry.
 *
 * @example
 * ```ts
 * Polling.adaptive({ active: "250 millis", idle: "30 seconds" })
 * // work → 250ms → 500ms → 1s → … → 30s → 30s (factor 2 default)
 * ```
 * @category presets
 * @public
 */
export const adaptive = (options: {
  readonly active: Duration.Input;
  readonly idle: Duration.Input;
  readonly factor?: number;
}): Layer.Layer<PollingTag> => {
  const activeMs = Duration.toMillis(Duration.fromInputUnsafe(options.active));
  const idleMs = Duration.toMillis(Duration.fromInputUnsafe(options.idle));
  const factor = options.factor ?? 2;
  const delayMs = (iteration: number): number =>
    Math.min(activeMs * Math.pow(factor, iteration), idleMs);

  return registerPollingLayer(
    Layer.effect(
      PollingTag,
      Effect.gen(function* () {
        const iteration = yield* Ref.make(0);
        const wakeRef = yield* Ref.make<Deferred.Deferred<void, never>>(
          Deferred.makeUnsafe()
        );
        const requestWake = Effect.flatMap(Ref.get(wakeRef), (d) =>
          Deferred.succeed(d, undefined)
        ).pipe(Effect.asVoid);
        const awaitNextTick = Effect.gen(function* () {
          const d = Deferred.makeUnsafe<void, never>();
          yield* Ref.set(wakeRef, d);
          const n = yield* Ref.get(iteration);
          yield* Effect.race(
            Effect.sleep(Duration.millis(delayMs(n))),
            Deferred.await(d)
          ).pipe(Effect.asVoid);
        });
        return {
          awaitNextTick,
          requestWake,
          // work signal: snap back to `active` and end the current wait
          resetCadence: Ref.set(iteration, 0).pipe(Effect.andThen(requestWake)),
          afterTick: Ref.update(iteration, (n) => n + 1),
          peekCadence: Effect.map(Ref.get(iteration), (n) =>
            Option.some(Duration.millis(delayMs(n)))
          ),
        } satisfies PollingService;
      })
    )
  );
};

// ============================================================================
// Event-driven wake
// ============================================================================

/**
 * Wire a stream to a cadence control: every element runs `wake` (or any control effect), so an
 * external fact — a queue `add` event, a store change — ends the polling wait IMMEDIATELY
 * instead of waiting out the interval. Forked into the current scope.
 *
 * Pair with {@link adaptive}: point it at `daemon.polling.resetCadence` and arrivals snap the
 * drainer back to its `active` cadence.
 *
 * @example
 * ```ts
 * yield* Polling.wakeOn(queue.events, daemon.polling.resetCadence)
 * ```
 * @category combinators
 * @public
 */
export const wakeOn = <A, R>(
  stream: Stream.Stream<A, never, R>,
  wake: Effect.Effect<void>
): Effect.Effect<void, never, R | Scope.Scope> =>
  Effect.asVoid(Effect.forkScoped(Stream.runForEach(stream, () => wake)));

// ============================================================================
// Preset: cron (calendar-scheduled ticks)
// ============================================================================

/**
 * Ticks on a cron schedule — each wait sleeps until the expression's NEXT occurrence (UTC),
 * so ticks land on calendar boundaries instead of relative intervals. `requestWake` /
 * `resetCadence` end the current wait early (the tick runs now; the next wait re-aims at the
 * following occurrence). An invalid expression fails AT CONSTRUCTION, not at the first tick.
 *
 * For arming/disarming by calendar windows use a schedule ({@link DaemonSchedule}); `cron` is
 * cadence WITHIN the armed window.
 *
 * @example
 * ```ts
 * Polling.cron("0 * * * *")   // every hour, on the hour
 * Polling.cron("*\/5 * * * *") // every five minutes
 * ```
 * @category presets
 * @public
 */
export const cron = (
  expression: string | Cron.Cron
): Layer.Layer<PollingTag> => {
  // eager + loud: a bad expression is a construction defect, never a silent never-ticking poll
  const parsed =
    typeof expression === "string" ? Cron.parseUnsafe(expression) : expression;
  return registerPollingLayer(
    Layer.effect(
      PollingTag,
      Effect.gen(function* () {
        const wakeRef = yield* Ref.make<Deferred.Deferred<void, never>>(
          Deferred.makeUnsafe()
        );
        const requestWake = Effect.flatMap(Ref.get(wakeRef), (d) =>
          Deferred.succeed(d, undefined)
        ).pipe(Effect.asVoid);
        const untilNext = Effect.map(Clock.currentTimeMillis, (now) =>
          Duration.millis(
            Math.max(
              0,
              Cron.next(
                parsed,
                DateTime.toDateUtc(DateTime.makeUnsafe(now))
              ).getTime() - now
            )
          )
        );
        const awaitNextTick = Effect.gen(function* () {
          const d = Deferred.makeUnsafe<void, never>();
          yield* Ref.set(wakeRef, d);
          const dur = yield* untilNext;
          yield* Effect.race(Effect.sleep(dur), Deferred.await(d)).pipe(
            Effect.asVoid
          );
        });
        return {
          awaitNextTick,
          requestWake,
          resetCadence: requestWake,
          afterTick: Effect.void,
          peekCadence: Effect.map(untilNext, Option.some),
        } satisfies PollingService;
      })
    )
  );
};

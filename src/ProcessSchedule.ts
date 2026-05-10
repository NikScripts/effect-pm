/**
 * **ProcessSchedule** — arms or disarms whether a {@link Process} may poll.
 *
 * This is intentionally **not** named `Schedule` to avoid clashing with
 * `import { Schedule } from "effect"`.
 *
 * @remarks
 * While **disarmed**, a running {@link Process} supervisor **does not** run
 * polling ticks; it waits for the gate to become armed again (interruptible sleep
 * between checks). {@link Process.runImmediately} still runs one tracked execution
 * of the user `effect` even when disarmed. Call {@link ProcessGroup.startProcess}
 * (or `startAll`) **once** to attach the supervisor; arm/disarm then controls ticks.
 *
 * @module ProcessSchedule
 */

import { Clock, Cron, Context, Duration, Effect, Layer, Option, Ref, Schedule } from "effect";

// ============================================================================
// Service
// ============================================================================

/**
 * Gate + optional status hints for {@link Process.getStatus}.
 *
 * @public
 */
export interface ProcessScheduleService {
  /** `true` when polling ticks are allowed. */
  readonly armed: Effect.Effect<boolean>;
  /**
   * Snapshot for dashboards: current arm state and best-effort next transition.
   *
   * @remarks
   * **`nextScheduleTransition`** — best-effort instant for “something about the gate
   * may change” (cron layers use the earliest next cron fire). While **disarmed**,
   * {@link Process} may sleep until near this time instead of only the configured
   * fallback poll. Custom layers may return `none`
   * if unknown.
   */
  readonly status: Effect.Effect<{
    readonly armed: boolean;
    readonly nextScheduleTransition: Option.Option<Date>;
  }>;
}

const ProcessScheduleTag = Context.Service<ProcessScheduleService>(
  "@effect-pm/ProcessSchedule",
);

const minDate = (dates: ReadonlyArray<Date>): Date =>
  new Date(Math.min(...dates.map((d) => d.getTime())));

const nextCronTransition = (
  crons: ReadonlyArray<Cron.Cron>,
  reference: Date,
): Option.Option<Date> => {
  if (crons.length === 0) {
    return Option.none();
  }
  const nextRuns = crons.map((c) => Cron.next(c, reference));
  return Option.some(minDate(nextRuns));
};

const cronArmedNow = (crons: ReadonlyArray<Cron.Cron>, now: Date): boolean =>
  crons.some((c) => Cron.match(c, now));

// ============================================================================
// Presets
// ============================================================================

const alwaysArmedLayer: Layer.Layer<ProcessScheduleService, never, never> = Layer.succeed(
  ProcessScheduleTag,
  {
    armed: Effect.succeed(true),
    status: Effect.succeed({
      armed: true,
      nextScheduleTransition: Option.none(),
    }),
  },
);

/**
 * Arms the gate when **any** cron expression {@link Cron.match | matches} “now”.
 *
 * @remarks
 * A scoped background fiber calls `Cron.match` / `Cron.next` on a fixed cadence
 * (`sampleInterval`, default **one second`) using {@link Clock.currentTimeMillis}
 * (so it follows the runtime clock, including {@link TestClock} when that is the
 * active clock). Use a shorter interval only when you need faster arm/disarm
 * detection at the cost of more wakeups. For deterministic tests you can still
 * prefer {@link ProcessSchedule.fromArmedRef} when you want direct ref control.
 */
const cronMatchLayer = (config: {
  readonly crons: Cron.Cron | ReadonlyArray<Cron.Cron>;
  /** How often to recompute {@link Cron.match} against the wall clock. */
  readonly sampleInterval?: Duration.Duration;
}): Layer.Layer<ProcessScheduleService, never, never> =>
  Layer.effect(
    ProcessScheduleTag,
    Effect.gen(function* () {
      const crons = Array.isArray(config.crons) ? config.crons : [config.crons];
      const sample = config.sampleInterval ?? Duration.seconds(1);
      const t0 = yield* Clock.currentTimeMillis;
      const now0 = new Date(t0);
      const armedRef = yield* Ref.make(cronArmedNow(crons, now0));
      const transitionRef = yield* Ref.make<Option.Option<Date>>(
        nextCronTransition(crons, now0),
      );

      const recompute = Effect.gen(function* () {
        const t = yield* Clock.currentTimeMillis;
        const now = new Date(t);
        const armed = cronArmedNow(crons, now);
        yield* Ref.set(armedRef, armed);
        yield* Ref.set(transitionRef, nextCronTransition(crons, now));
      });

      yield* Effect.forkScoped(
        Effect.repeat(recompute, Schedule.spaced(sample)).pipe(Effect.interruptible),
      );

      const impl: ProcessScheduleService = {
        armed: Ref.get(armedRef),
        status: Effect.gen(function* () {
          const armed = yield* Ref.get(armedRef);
          const nextScheduleTransition = yield* Ref.get(transitionRef);
          return { armed, nextScheduleTransition };
        }),
      };

      return impl;
    }),
  );

/**
 * Gate from mutable refs (ideal for tests and feature flags).
 *
 * @remarks
 * Pass `nextScheduleTransition` when you know the next time the arm state might
 * change; {@link Process} uses it for disarmed idle sleep (with the same
 * {@link Clock} as the runtime) instead of relying only on the fallback poll.
 */
const fromArmedRefLayer = (options: {
  readonly armed: Ref.Ref<boolean>;
  readonly nextScheduleTransition?: Ref.Ref<Option.Option<Date>>;
}): Layer.Layer<ProcessScheduleService, never, never> => {
  const transitionRef = options.nextScheduleTransition;
  return Layer.succeed(ProcessScheduleTag, {
    armed: Ref.get(options.armed),
    status: Effect.gen(function* () {
      const armed = yield* Ref.get(options.armed);
      const nextScheduleTransition =
        transitionRef !== undefined
          ? yield* Ref.get(transitionRef)
          : Option.none<Date>();
      return { armed, nextScheduleTransition };
    }),
  });
};

/**
 * Context tag for {@link ProcessScheduleService}, merged with static layer factories.
 *
 * @remarks
 * Use with `yield* ProcessSchedule` inside an effect that is provided one of:
 * - {@link ProcessSchedule.alwaysArmed}
 * - {@link ProcessSchedule.cronMatch}
 * - {@link ProcessSchedule.fromArmedRef}
 *
 * @public
 */
export const ProcessSchedule: typeof ProcessScheduleTag & {
  readonly alwaysArmed: typeof alwaysArmedLayer;
  readonly cronMatch: typeof cronMatchLayer;
  readonly fromArmedRef: typeof fromArmedRefLayer;
} = Object.assign(ProcessScheduleTag, {
  alwaysArmed: alwaysArmedLayer,
  cronMatch: cronMatchLayer,
  fromArmedRef: fromArmedRefLayer,
});

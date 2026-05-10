/**
 * **Process** — supervised repeat of a user **`effect`**, gated by
 * {@link ProcessSchedule} and cadenced by {@link Polling}.
 *
 * @remarks
 * **Supervisor** (single fiber forked by {@link ProcessGroup}): an **outer** loop
 * waits until {@link ProcessSchedule.status} is **armed** (interruptible sleep
 * while disarmed — no busy spin). When `status.nextScheduleTransition` is set
 * (e.g. {@link ProcessSchedule.cronMatch}), sleep duration follows that hint
 * (clamped); otherwise sleep uses {@link ProcessMakeConfig.schedulePollWhileDisarmed}
 * or a calm default. An **inner** loop then reads the
 * gate each tick: if **armed**, it uses {@link Polling.awaitNextTick}, runs the
 * tracked user **`effect`** once, then {@link Polling.afterTick}; if **disarmed**,
 * the inner loop exits and the outer loop waits again. One `startProcess` keeps
 * this fiber alive across arm/disarm cycles so the **schedule drives when ticks
 * run**, not repeated starts.
 *
 * **Semantics** (`docs/plans/09-process-v2-effect-first.md`):
 * - **Disarmed:** no scheduled ticks; the supervisor **waits** for the next armed
 *   window (hint-based sleep when available, else a configurable fallback poll).
 *   `runImmediately` still runs once without an armed gate.
 * - **`ProcessGroup.stop`:** interrupts the supervisor (in-flight work may be interrupted).
 * - **`runImmediately`:** one tracked run of the user `effect` **even when disarmed**;
 *   it may overlap an in-flight scheduled tick (separate fiber from the poll loop).
 *
 * @module Process
 */

import { Clock, Duration, Effect, Layer, MutableRef, Option } from "effect";
import {
  computeDisarmedIdleSleep,
  resolveDisarmedFallbackPoll,
} from "./disarmedIdleSleep";
import { ProcessStore } from "./ProcessStore";
import { Polling } from "./Polling";
import { ProcessSchedule } from "./ProcessSchedule";
import type { PollingService } from "./Polling";
import type { ProcessScheduleService } from "./ProcessSchedule";

// ============================================================================
// Public types
// ============================================================================

/**
 * Analytics + live gate snapshot returned by {@link Process.getStatus}.
 *
 * @public
 */
export interface ProcessDetails {
  /** When the user `effect` last completed a tracked run (any trigger). */
  readonly lastRun: Date | null;
  /** Count of completed execution records in range (or all time if no range). */
  readonly executions: number;
  /** First execution flagged as startup, if any. */
  readonly firstStartup: Date | null;
  /** Last observed arm state from {@link ProcessSchedule}. */
  readonly armed: boolean;
  /** Best-effort next schedule transition (cron layers populate). */
  readonly nextScheduleTransition: Option.Option<Date>;
  /** Best-effort next cadence delay before the next poll attempt while armed. */
  readonly nextPollCadence: Option.Option<Duration.Duration>;
}

/**
 * @deprecated Use {@link ProcessDetails}. Retained as alias for searchability.
 * @public
 */
export type ScheduledProcessDetails = ProcessDetails;

/**
 * @deprecated Cron-only shape from pre–v0.7 `Process`. Use {@link ProcessDetails}.
 * @public
 */
export interface CronDetails {
  readonly lastRun: Date | null;
  readonly executions: number;
  readonly nextRun: Date;
  readonly firstStartup: Date | null;
  readonly crons: readonly never[];
}

/**
 * Managed process handle for {@link ProcessGroup}.
 *
 * @typeParam R — Environment required to run {@link Process.effect} (after optional inline layers).
 *
 * @remarks
 * **TypeScript vs runtime:** Inlined `polling` / `schedule` layers are applied to the
 * supervisor step at build time, but the type checker may still list
 * `PollingService | ProcessScheduleService` on {@link Process.effect}. At fork time,
 * merge a `Layer` that includes those services anyway (duplicate `Layer.succeed`
 * presets are safe). See the `provideStepLayers` comment in this module.
 *
 * @public
 */
export interface Process<out R> {
  readonly name: string;
  /** Discriminator for HTTP / CLI consumers. */
  readonly type: "managed";
  /**
   * Long-running supervised program: schedule sampling, polling loop, analytics.
   *
   * @remarks
   * Environment is `R` combined with {@link ProcessStore}: `ProcessStore` is always required
   * for execution records. Optional `polling` / `schedule` from {@link Process.make}
   * are merged into this effect so `R` is only **leftover** services (typically
   * from the user `effect`).
   *
   * The supervisor uses the runtime {@link Clock} for disarmed idle sleep, aligned
   * with {@link ProcessSchedule.cronMatch} when that layer is used (both use the
   * same clock service).
   */
  readonly effect: Effect.Effect<void, never, R | ProcessStore>;
  readonly getStatus: (dateRange?: {
    start: Date;
    end: Date;
  }) => Effect.Effect<ProcessDetails, never, ProcessStore>;
  /**
   * Runs the user `effect` once with {@link ProcessStore} tracking.
   *
   * @remarks
   * Does **not** require the schedule to be armed. May overlap a concurrent
   * scheduled tick (the supervisor runs on a single fiber for polling, but
   * `runImmediately` does not participate in that loop).
   */
  readonly runImmediately: () => Effect.Effect<void, never, R | ProcessStore>;
}

/**
 * Extract service requirements from a {@link Process} handle.
 *
 * @public
 */
export type ProcessEffectRequirements<P> = P extends Process<infer R> ? R : never;

// ============================================================================
// Internal
// ============================================================================

type AnyPollingLayer = Layer.Layer<PollingService, never, never>;
type AnyScheduleLayer = Layer.Layer<ProcessScheduleService, never, never>;

interface ProcessMirror {
  readonly armed: MutableRef.MutableRef<boolean>;
  readonly nextScheduleTransition: MutableRef.MutableRef<Option.Option<Date>>;
  readonly nextPollCadence: MutableRef.MutableRef<Option.Option<Duration.Duration>>;
}

interface ProcessBuildState<E, RUser> {
  readonly name: string;
  readonly userEffect: Effect.Effect<void, E, RUser>;
  readonly pollingLayer?: AnyPollingLayer;
  readonly scheduleLayer?: AnyScheduleLayer;
  /** Fallback disarmed sleep when schedule provides no `nextScheduleTransition`. */
  readonly schedulePollWhileDisarmed?: Duration.Duration;
}

const writeScheduleMirror = (
  mirror: ProcessMirror,
  st: { readonly armed: boolean; readonly nextScheduleTransition: Option.Option<Date> },
  nextPollCadence: Option.Option<Duration.Duration>,
): void => {
  MutableRef.set(mirror.armed, st.armed);
  MutableRef.set(mirror.nextScheduleTransition, st.nextScheduleTransition);
  MutableRef.set(mirror.nextPollCadence, nextPollCadence);
};

/**
 * Bakes optional cadence / gate layers into the **supervisor** program (the long
 * runner that reads the gate and runs ticks). Same `Effect.provide` typing notes
 * as before apply at fork sites (see {@link Process}).
 */
const provideStepLayers = <R>(
  step: Effect.Effect<void, never, R>,
  state: Pick<ProcessBuildState<never, never>, "pollingLayer" | "scheduleLayer">,
) => {
  const { pollingLayer, scheduleLayer } = state;
  if (pollingLayer !== undefined && scheduleLayer !== undefined) {
    return step.pipe(Effect.provide(pollingLayer), Effect.provide(scheduleLayer));
  }
  if (pollingLayer !== undefined) {
    return step.pipe(Effect.provide(pollingLayer));
  }
  if (scheduleLayer !== undefined) {
    return step.pipe(Effect.provide(scheduleLayer));
  }
  return step;
};

const createProcess = <E, RUser>(state: ProcessBuildState<E, RUser>) => {
  const { name, userEffect } = state;
  const disarmedFallbackPoll = resolveDisarmedFallbackPoll(state.schedulePollWhileDisarmed);

  const mirror: ProcessMirror = {
    armed: MutableRef.make(false),
    nextScheduleTransition: MutableRef.make<Option.Option<Date>>(Option.none()),
    nextPollCadence: MutableRef.make<Option.Option<Duration.Duration>>(Option.none()),
  };

  let executionRecordId = 0;

  const recordExecutionEvent = (args: {
    readonly scheduleKey: string | null;
    readonly startedAt: Date;
    readonly completedAt: Date;
    readonly status: "completed" | "failed" | "interrupted";
    readonly error?: unknown;
    readonly isStartupRun: boolean;
  }): Effect.Effect<void, never, ProcessStore> =>
    Effect.gen(function* () {
      const store = yield* ProcessStore;
      executionRecordId += 1;
      yield* store.append({
        id: `${name}-execution-${executionRecordId}`,
        type: "process.execution.completed",
        occurredAt: args.completedAt,
        entityType: "process",
        entityId: name,
        execution: {
          scheduleKey: args.scheduleKey,
          startedAt: args.startedAt,
          completedAt: args.completedAt,
          durationMs: Math.max(
            0,
            args.completedAt.getTime() - args.startedAt.getTime(),
          ),
          status: args.status,
          error: args.error === undefined ? undefined : String(args.error),
          isStartupRun: args.isStartupRun,
        },
      });
    });

  const trackedProgram: Effect.Effect<void, never, RUser | ProcessStore> = Effect.gen(function* () {
    const store = yield* ProcessStore;
    const executedAt = new Date();
    const isStartupRun =
      (yield* store.getProcessExecutions(name, { limit: 1 })).length === 0;

    /** Use {@link Effect.matchEffect} so handler bodies (store append + logs) actually run. */
    yield* Effect.matchEffect(userEffect, {
      onFailure: (error) =>
        Effect.gen(function* () {
          const completedAt = new Date();
          yield* recordExecutionEvent({
            scheduleKey: null,
            startedAt: executedAt,
            completedAt,
            status: "failed",
            error,
            isStartupRun,
          });
          yield* Effect.logError(
            `❌ Process '${name}' tick failed at ${executedAt.toISOString()}: ${String(error)}`,
          );
        }),
      onSuccess: () =>
        Effect.gen(function* () {
          const completedAt = new Date();
          yield* recordExecutionEvent({
            scheduleKey: null,
            startedAt: executedAt,
            completedAt,
            status: "completed",
            isStartupRun,
          });
          yield* Effect.logDebug(
            `✅ Process '${name}' tick completed at ${executedAt.toISOString()}`,
          );
        }),
    });
  });

  /**
   * Single-fiber supervisor: wait until **armed**, run ticks until **disarmed**,
   * repeat until interrupted (e.g. `ProcessGroup.stopProcess`).
   */
  const waitUntilScheduleArmed = Effect.gen(function* () {
    for (;;) {
      const schedule = yield* ProcessSchedule;
      const st = yield* schedule.status;
      writeScheduleMirror(mirror, st, Option.none());
      if (st.armed) {
        return;
      }
      const nowMillis = yield* Clock.currentTimeMillis;
      const sleepFor = computeDisarmedIdleSleep({
        now: new Date(nowMillis),
        nextScheduleTransition: st.nextScheduleTransition,
        fallbackPoll: disarmedFallbackPoll,
      });
      yield* Effect.sleep(sleepFor);
    }
  });

  const runTicksWhileScheduleArmed = Effect.gen(function* () {
    for (;;) {
      const polling = yield* Polling;
      const schedule = yield* ProcessSchedule;
      const st = yield* schedule.status;

      if (!st.armed) {
        writeScheduleMirror(mirror, st, Option.none());
        return;
      }

      const cadencePeek = yield* polling.peekCadence;
      writeScheduleMirror(mirror, st, cadencePeek);

      yield* polling.awaitNextTick;
      yield* trackedProgram;
      yield* polling.afterTick;
    }
  });

  const supervisedCore = Effect.gen(function* () {
    for (;;) {
      yield* waitUntilScheduleArmed;
      yield* runTicksWhileScheduleArmed;
    }
  });

  const supervised = provideStepLayers(supervisedCore, state);

  const getStatus = (dateRange?: {
    start: Date;
    end: Date;
  }): Effect.Effect<ProcessDetails, never, ProcessStore> =>
    Effect.gen(function* () {
      const store = yield* ProcessStore;
      const allExecutions = yield* store.getProcessExecutions(name);
      const inRange = dateRange
        ? allExecutions.filter(
            (event) =>
              event.execution.startedAt >= dateRange.start &&
              event.execution.startedAt <= dateRange.end,
          )
        : allExecutions;
      const lastRun = allExecutions[0]?.execution.startedAt ?? null;
      const executions = inRange.length;
      const firstStartup =
        allExecutions.find((event) => event.execution.isStartupRun)?.execution
          .startedAt ?? null;

      return {
        lastRun,
        executions,
        firstStartup,
        armed: MutableRef.get(mirror.armed),
        nextScheduleTransition: MutableRef.get(mirror.nextScheduleTransition),
        nextPollCadence: MutableRef.get(mirror.nextPollCadence),
      };
    });

  const runImmediately = (): Effect.Effect<void, never, RUser | ProcessStore> =>
    Effect.gen(function* () {
      yield* Effect.logInfo(
        `🚀 Running '${name}' immediately (tracked; does not require schedule armed)...`,
      );
      yield* trackedProgram;
      yield* Effect.logDebug(`✅ Completed immediate run of '${name}'`);
    });

  return {
    name,
    type: "managed" as const,
    effect: supervised,
    getStatus,
    runImmediately,
  };
};

// ============================================================================
// Public API
// ============================================================================

/**
 * Configuration for {@link Process.make}.
 *
 * @public
 */
export interface ProcessMakeConfig<E, RUser> {
  readonly name: string;
  readonly effect: Effect.Effect<void, E, RUser>;
  readonly polling?: AnyPollingLayer;
  readonly schedule?: AnyScheduleLayer;
  /**
   * When the gate is **disarmed** and {@link ProcessScheduleService.status} has
   * `nextScheduleTransition: none`, the supervisor sleeps this long between
   * re-checks. When the schedule supplies a transition date (e.g. cron layers),
   * sleep is derived from that hint instead (clamped to 1s–5min).
   *
   * Values below **100 ms** are raised to 100 ms so a misconfigured `Duration.zero`
   * cannot busy-loop. {@link computeDisarmedIdleSleep} documents the full policy.
   *
   * @defaultValue Five seconds — calm for production; use a shorter value in
   * tests with {@link TestClock}.
   */
  readonly schedulePollWhileDisarmed?: Duration.Duration;
}

/**
 * Create a managed {@link Process}.
 *
 * @example
 * ```ts
 * import { Process, Polling, ProcessSchedule } from "@nikscripts/effect-pm";
 * import { Duration, Effect } from "effect";
 *
 * const worker = Process.make({
 *   name: "worker",
 *   effect: Effect.logInfo("tick"),
 *   polling: Polling.spaced(Duration.seconds(5)),
 *   schedule: ProcessSchedule.alwaysArmed,
 * });
 * ```
 *
 * @public
 */
const make = <E, RUser>(config: ProcessMakeConfig<E, RUser>) =>
  createProcess({
    name: config.name,
    userEffect: config.effect,
    pollingLayer: config.polling,
    scheduleLayer: config.schedule,
    schedulePollWhileDisarmed: config.schedulePollWhileDisarmed,
  });

/**
 * Attach a {@link Polling} layer after {@link Process.make} (replaces any prior polling layer).
 *
 * @public
 */
const providePolling = <E, RUser>(base: ProcessMakeConfig<E, RUser>, layer: AnyPollingLayer) =>
  createProcess({
    name: base.name,
    userEffect: base.effect,
    pollingLayer: layer,
    scheduleLayer: base.schedule,
    schedulePollWhileDisarmed: base.schedulePollWhileDisarmed,
  });

/**
 * Attach a {@link ProcessSchedule} layer after defining the base config (replaces any prior schedule layer).
 *
 * @public
 */
const provideSchedule = <E, RUser>(base: ProcessMakeConfig<E, RUser>, layer: AnyScheduleLayer) =>
  createProcess({
    name: base.name,
    userEffect: base.effect,
    pollingLayer: base.polling,
    scheduleLayer: layer,
    schedulePollWhileDisarmed: base.schedulePollWhileDisarmed,
  });

/**
 * @public
 */
export const Process = {
  make,
  providePolling,
  provideSchedule,
} as const;

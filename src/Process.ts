/**
 * **Process** — trigger-driven supervised instances.
 *
 * @remarks
 * A started process has a long-lived **driver** fiber that follows
 * {@link ProcessSchedule} entries. Each eligible `startAt` spawns a run instance.
 * Inside an instance,
 * we repeatedly:
 * 1. check the active entry `stopAt`
 * 2. if closed: exit the instance naturally
 * 3. otherwise await {@link Polling.awaitNextTick}, run the tracked user effect,
 *    then {@link Polling.afterTick}.
 *
 * Default overlap policy is **parallel** because the driver forks each instance.
 *
 * @module Process
 */

import { Clock, Context, DateTime, Duration, Effect, Fiber, Layer, MutableRef, Option } from "effect";
import { ProcessStore } from "./ProcessStore";
import { Polling } from "./Polling";
import { ProcessSchedule } from "./ProcessSchedule";
import type { PollingTag } from "./Polling";
import type {
  ProcessScheduleEntry,
  ProcessScheduleService,
  ProcessScheduleTag,
} from "./ProcessSchedule";
import { provideLayer } from "./provideLayer.js";

// ============================================================================
// Public types
// ============================================================================

/**
 * Analytics + live runtime snapshot returned by {@link Process.getStatus}.
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
  /** Best-effort next polling cadence observed in a running instance. */
  readonly nextPollCadence: Option.Option<Duration.Duration>;
  /** Active instances spawned by the trigger driver and not yet finished. */
  readonly activeInstances: number;
  /** Best-effort next trigger run (currently none for generic schedules). */
  readonly nextTriggerRun: Option.Option<Date>;
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
 * @public
 */
export interface Process<out R> {
  readonly name: string;
  readonly type: "managed";
  /**
   * Long-running trigger driver that spawns run instances.
   */
  readonly effect: Effect.Effect<void, never, R | ProcessStore>;
  readonly getStatus: (dateRange?: {
    start: Date;
    end: Date;
  }) => Effect.Effect<ProcessDetails, never, ProcessStore>;
  /**
   * Runs the user `effect` once with tracking, independent of trigger cadence.
   */
  readonly runImmediately: () => Effect.Effect<void, never, R | ProcessStore>;
}

/**
 * Extract service requirements from a {@link Process} handle.
 *
 * @public
 */
export type ProcessEffectRequirements<P> = P extends Process<infer R> ? R : never;

/**
 * Context for the currently running scheduled window.
 *
 * @public
 */
export interface ProcessScheduleContext {
  readonly id: Option.Option<string>;
}

class ProcessScheduleContextTag extends Context.Service<
  ProcessScheduleContextTag,
  ProcessScheduleContext
>()("@nikscripts/effect-pm/Process/ProcessScheduleContextTag") {}

class ProcessScheduleControlsTag extends Context.Service<
  ProcessScheduleControlsTag,
  ProcessScheduleControls
>()("@nikscripts/effect-pm/Process/ProcessScheduleControlsTag") {}

/**
 * Identifier attached to the schedule entry that started the current run.
 *
 * @remarks
 * - For scheduled runs: value from `ProcessScheduleEntry.id`
 * - For `runImmediately()`: `Option.none()`
 *
 * @public
 */
export const currentScheduleId: Effect.Effect<Option.Option<string>, never, never> =
  Effect.serviceOption(ProcessScheduleContextTag).pipe(
    Effect.map(
      Option.match({
        onNone: () => Option.none(),
        onSome: (ctx) => ctx.id,
      }),
    ),
  );

/**
 * Schedule controls for the currently running process runtime.
 *
 * @remarks
 * Available from both:
 * - `Process.make({ schedule: (controls) => ... })`
 * - inside the process `effect` via this accessor.
 *
 * @public
 */
export const scheduleControls: Effect.Effect<ProcessScheduleControls, never, never> =
  Effect.serviceOption(ProcessScheduleControlsTag).pipe(
    Effect.map(
      Option.match({
        onNone: () => ({
          entries: Effect.succeed([]),
          set: () => Effect.void,
          add: () => Effect.void,
          clear: Effect.void,
        }),
        onSome: (controls) => controls,
      }),
    ),
  );

// ============================================================================
// Internal
// ============================================================================

type AnyPollingLayer = Layer.Layer<PollingTag, never, never>;
type AnyScheduleLayer = Layer.Layer<ProcessScheduleTag, never, never>;

interface ProcessMirror {
  readonly armed: MutableRef.MutableRef<boolean>;
  readonly nextScheduleTransition: MutableRef.MutableRef<Option.Option<Date>>;
  readonly nextPollCadence: MutableRef.MutableRef<Option.Option<Duration.Duration>>;
  readonly activeInstances: MutableRef.MutableRef<number>;
  readonly nextTriggerRun: MutableRef.MutableRef<Option.Option<Date>>;
}

interface ProcessBuildStateBase<E, RUser> {
  readonly name: string;
  readonly userEffect: Effect.Effect<void, E, RUser>;
  readonly scheduleInitializer?: ProcessScheduleInitializer<RUser>;
}

export interface ProcessScheduleControls {
  readonly entries: Effect.Effect<ReadonlyArray<ProcessScheduleEntry>, never, never>;
  readonly set: (
    entries: ReadonlyArray<ProcessScheduleEntry>,
  ) => Effect.Effect<void, never, never>;
  readonly add: (
    entry: ProcessScheduleEntry,
  ) => Effect.Effect<void, never, never>;
  readonly clear: Effect.Effect<void, never, never>;
}

export type ProcessScheduleInitializer<R = never> = (
  controls: ProcessScheduleControls,
) => Effect.Effect<void, never, R>;

type ProcessBuildStateWithPollingAndSchedule<E, RUser> =
  & ProcessBuildStateBase<E, RUser>
  & {
    readonly pollingLayer: AnyPollingLayer;
    readonly scheduleLayer: AnyScheduleLayer;
  };

type ProcessBuildStateWithPolling<E, RUser> =
  & ProcessBuildStateBase<E, RUser>
  & {
    readonly pollingLayer: AnyPollingLayer;
    readonly scheduleLayer?: undefined;
  };

type ProcessBuildStateWithSchedule<E, RUser> =
  & ProcessBuildStateBase<E, RUser>
  & {
    readonly pollingLayer?: undefined;
    readonly scheduleLayer: AnyScheduleLayer;
  };

type ProcessBuildStateWithoutStepLayers<E, RUser> =
  & ProcessBuildStateBase<E, RUser>
  & {
    readonly pollingLayer?: undefined;
    readonly scheduleLayer?: undefined;
  };

type AnyProcessBuildState<E, RUser> =
  | ProcessBuildStateWithPollingAndSchedule<E, RUser>
  | ProcessBuildStateWithPolling<E, RUser>
  | ProcessBuildStateWithSchedule<E, RUser>
  | ProcessBuildStateWithoutStepLayers<E, RUser>;

const writeScheduleMirror = (
  mirror: ProcessMirror,
  st: { readonly armed: boolean; readonly nextScheduleTransition: Option.Option<Date> },
  nextPollCadence: Option.Option<Duration.Duration>,
): void => {
  MutableRef.set(mirror.armed, st.armed);
  MutableRef.set(mirror.nextScheduleTransition, st.nextScheduleTransition);
  MutableRef.set(mirror.nextPollCadence, nextPollCadence);
};

const provideWithLayer = <A, E, RIn, ROut>(
  step: Effect.Effect<A, E, RIn>,
  layer: Layer.Layer<ROut, E, never>,
): Effect.Effect<A, E, Exclude<RIn, ROut>> =>
  Effect.scoped(
    Effect.gen(function* () {
      const context = yield* Layer.build(layer);
      return yield* step.pipe(provideLayer(context));
    }),
  );

function provideStepLayers<R>(
  step: Effect.Effect<void, never, R>,
  state: Pick<
    ProcessBuildStateWithPollingAndSchedule<never, never>,
    "pollingLayer" | "scheduleLayer"
  >,
): Effect.Effect<void, never, Exclude<Exclude<R, PollingTag>, ProcessScheduleTag>>;
function provideStepLayers<R>(
  step: Effect.Effect<void, never, R>,
  state: Pick<
    ProcessBuildStateWithPolling<never, never>,
    "pollingLayer" | "scheduleLayer"
  >,
): Effect.Effect<void, never, Exclude<R, PollingTag>>;
function provideStepLayers<R>(
  step: Effect.Effect<void, never, R>,
  state: Pick<
    ProcessBuildStateWithSchedule<never, never>,
    "pollingLayer" | "scheduleLayer"
  >,
): Effect.Effect<void, never, Exclude<R, ProcessScheduleTag>>;
function provideStepLayers<R>(
  step: Effect.Effect<void, never, R>,
  state: Pick<
    ProcessBuildStateWithoutStepLayers<never, never>,
    "pollingLayer" | "scheduleLayer"
  >,
): Effect.Effect<void, never, R>;
function provideStepLayers<R>(
  step: Effect.Effect<void, never, R>,
  state: Pick<AnyProcessBuildState<never, never>, "pollingLayer" | "scheduleLayer">,
) {
  const { pollingLayer, scheduleLayer } = state;
  if (pollingLayer !== undefined && scheduleLayer !== undefined) {
    return provideWithLayer(step, Layer.mergeAll(pollingLayer, scheduleLayer));
  }
  if (pollingLayer !== undefined) {
    return provideWithLayer(step, pollingLayer);
  }
  if (scheduleLayer !== undefined) {
    return provideWithLayer(step, scheduleLayer);
  }
  return step;
}

function createProcess<E, RUser>(
  state: ProcessBuildStateWithPollingAndSchedule<E, RUser>,
): Process<RUser>;
function createProcess<E, RUser>(
  state: ProcessBuildStateWithPolling<E, RUser>,
): Process<RUser>;
function createProcess<E, RUser>(
  state: ProcessBuildStateWithSchedule<E, RUser>,
): Process<RUser>;
function createProcess<E, RUser>(
  state: ProcessBuildStateWithoutStepLayers<E, RUser>,
): Process<RUser>;
function createProcess<E, RUser>(state: AnyProcessBuildState<E, RUser>) {
  const toScheduleControls = (
    schedule: ProcessScheduleService,
  ): ProcessScheduleControls => ({
    entries: schedule.entries,
    set: (entries) => schedule.set(entries),
    add: (entry) => schedule.add(entry),
    clear: schedule.clear,
  });

  const noScheduleControls: ProcessScheduleControls = {
    entries: Effect.succeed([]),
    set: () => Effect.void,
    add: () => Effect.void,
    clear: Effect.void,
  };

  const { name, userEffect } = state;

  const mirror: ProcessMirror = {
    armed: MutableRef.make(false),
    nextScheduleTransition: MutableRef.make<Option.Option<Date>>(Option.none()),
    nextPollCadence: MutableRef.make<Option.Option<Duration.Duration>>(Option.none()),
    activeInstances: MutableRef.make(0),
    nextTriggerRun: MutableRef.make<Option.Option<Date>>(Option.none()),
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

  const trackedProgram = (
    scheduleIdentifier: Option.Option<string>,
    controls: ProcessScheduleControls,
  ): Effect.Effect<void, never, RUser | ProcessStore> =>
    Effect.gen(function* () {
      const store = yield* ProcessStore;
      const executedAt = yield* DateTime.nowAsDate;
      const isStartupRun =
        (yield* store.getProcessExecutions(name, { limit: 1 })).length === 0;

      yield* Effect.matchEffect(
        userEffect.pipe(
          Effect.provideService(ProcessScheduleContextTag, {
            id: scheduleIdentifier,
          }),
          Effect.provideService(ProcessScheduleControlsTag, controls),
        ),
        {
          onFailure: (error) =>
            Effect.gen(function* () {
              const completedAt = yield* DateTime.nowAsDate;
              yield* recordExecutionEvent({
                scheduleKey: Option.getOrNull(scheduleIdentifier),
                startedAt: executedAt,
                completedAt,
                status: "failed",
                error,
                isStartupRun,
              });
              yield* Effect.logError(
                `❌ Process '${name}' run failed at ${executedAt.toISOString()}: ${String(error)}`,
              );
            }),
          onSuccess: () =>
            Effect.gen(function* () {
              const completedAt = yield* DateTime.nowAsDate;
              yield* recordExecutionEvent({
                scheduleKey: Option.getOrNull(scheduleIdentifier),
                startedAt: executedAt,
                completedAt,
                status: "completed",
                isStartupRun,
              });
              yield* Effect.logDebug(
                `✅ Process '${name}' run completed at ${executedAt.toISOString()}`,
              );
            }),
        },
      );
    });

  const minDate = (dates: ReadonlyArray<Date>): Option.Option<Date> => {
    if (dates.length === 0) {
      return Option.none();
    }
    const minEpochMs = Math.min(...dates.map((candidate) => candidate.getTime()));
    return Option.some(DateTime.toDateUtc(DateTime.makeUnsafe(minEpochMs)));
  };

  const summarizeScheduleState = (
    entries: ReadonlyArray<ProcessScheduleEntry>,
    now: Date,
  ): {
    readonly armed: boolean;
    readonly nextScheduleTransition: Option.Option<Date>;
    readonly nextTriggerRun: Option.Option<Date>;
  } => {
    const nowMs = now.getTime();
    const armed = entries.some((entry) => {
      const startMs = entry.startAt.getTime();
      if (startMs > nowMs) {
        return false;
      }
      return Option.match(entry.stopAt, {
        onNone: () => true,
        onSome: (stopAt) => stopAt.getTime() > nowMs,
      });
    });

    const transitionCandidates: Array<Date> = [];
    const nextStarts: Array<Date> = [];
    for (const entry of entries) {
      if (entry.startAt.getTime() > nowMs) {
        transitionCandidates.push(entry.startAt);
        nextStarts.push(entry.startAt);
      }
      if (Option.isSome(entry.stopAt) && entry.stopAt.value.getTime() > nowMs) {
        transitionCandidates.push(entry.stopAt.value);
      }
    }

    return {
      armed,
      nextScheduleTransition: minDate(transitionCandidates),
      nextTriggerRun: minDate(nextStarts),
    };
  };

  const refreshScheduleMirror = (
    entries: ReadonlyArray<ProcessScheduleEntry>,
  ): Effect.Effect<void, never, Clock.Clock> =>
    Effect.gen(function* () {
      const nowMillis = yield* Clock.currentTimeMillis;
      const now = DateTime.toDateUtc(DateTime.makeUnsafe(nowMillis));
      const stateSummary = summarizeScheduleState(entries, now);
      MutableRef.set(mirror.armed, stateSummary.armed);
      MutableRef.set(mirror.nextScheduleTransition, stateSummary.nextScheduleTransition);
      MutableRef.set(mirror.nextTriggerRun, stateSummary.nextTriggerRun);
    });

  interface PendingStart {
    readonly startAtMs: number;
    readonly fiber: Fiber.Fiber<void, never>;
  }

  const entryKeyFrom = (
    entry: ProcessScheduleEntry,
    index: number,
  ): string => {
    const stopPart = Option.match(entry.stopAt, {
      onNone: () => "none",
      onSome: (d) => String(d.getTime()),
    });
    return `${entry.startAt.getTime()}:${stopPart}:${index}`;
  };

  interface MaterializedEntry {
    readonly key: string;
    readonly entry: ProcessScheduleEntry;
  }

  const materializeEntries = (
    entries: ReadonlyArray<ProcessScheduleEntry>,
  ): ReadonlyArray<MaterializedEntry> =>
    entries.map((entry, index) => ({
      key: entryKeyFrom(entry, index),
      entry,
    }));

  const pendingStarts = MutableRef.make(new Map<string, PendingStart>());
  const runningByEntry = MutableRef.make(new Map<string, Fiber.Fiber<void, never>>());
  const completedEntries = MutableRef.make(new Set<string>());

  const spawnEntryInstance = (
    key: string,
    entry: ProcessScheduleEntry,
    controls: ProcessScheduleControls,
  ): Effect.Effect<void, never, RUser | PollingTag | ProcessScheduleTag | ProcessStore | Clock.Clock> =>
    Effect.gen(function* () {
      if (MutableRef.get(runningByEntry).has(key)) {
        return;
      }

      const runEntryInstance = Effect.gen(function* () {
        const pollingOption = yield* Effect.serviceOption(Polling);

        const canContinue = Effect.gen(function* () {
          const nowMillis = yield* Clock.currentTimeMillis;
          const now = DateTime.toDateUtc(DateTime.makeUnsafe(nowMillis));
          return Option.match(entry.stopAt, {
            onNone: () => true,
            onSome: (stopAt) => now < stopAt,
          });
        });

        if (Option.isNone(pollingOption)) {
          if (yield* canContinue) {
            yield* trackedProgram(entry.id, controls);
          }
          return;
        }

        const polling = pollingOption.value;
        for (;;) {
          if (!(yield* canContinue)) {
            return;
          }

          const schedule = yield* ProcessSchedule;
          const entries = yield* schedule.entries;
          yield* refreshScheduleMirror(entries);
          const cadencePeek = yield* polling.peekCadence;
          writeScheduleMirror(
            mirror,
            {
              armed: MutableRef.get(mirror.armed),
              nextScheduleTransition: MutableRef.get(mirror.nextScheduleTransition),
            },
            cadencePeek,
          );

          yield* polling.awaitNextTick;
          if (!(yield* canContinue)) {
            return;
          }
          yield* trackedProgram(entry.id, controls);
          yield* polling.afterTick;
        }
      });

      MutableRef.update(mirror.activeInstances, (n) => n + 1);
      const instanceFiber = yield* Effect.forkChild(
        runEntryInstance.pipe(
          Effect.ensuring(
            Effect.sync(() => {
              MutableRef.update(mirror.activeInstances, (n) => Math.max(0, n - 1));
              MutableRef.update(runningByEntry, (running) => {
                const next = new Map(running);
                next.delete(key);
                return next;
              });
              MutableRef.update(completedEntries, (completed) => {
                const next = new Set(completed);
                next.add(key);
                return next;
              });
            }),
          ),
        ),
      );

      MutableRef.update(runningByEntry, (running) => {
        const next = new Map(running);
        next.set(key, instanceFiber);
        return next;
      });
    });

  const scheduleFutureEntry = (
    key: string,
    entry: ProcessScheduleEntry,
    controls: ProcessScheduleControls,
  ): Effect.Effect<void, never, RUser | PollingTag | ProcessScheduleTag | ProcessStore | Clock.Clock> =>
    Effect.gen(function* () {
      const nowMillis = yield* Clock.currentTimeMillis;
      const delayMs = entry.startAt.getTime() - nowMillis;
      if (delayMs <= 0) {
        yield* spawnEntryInstance(key, entry, controls);
        return;
      }

      const sleeper = yield* Effect.forkChild(
        Effect.sleep(Duration.millis(delayMs)).pipe(
          Effect.andThen(() => spawnEntryInstance(key, entry, controls)),
          Effect.ensuring(
            Effect.sync(() => {
              MutableRef.update(pendingStarts, (pending) => {
                const next = new Map(pending);
                next.delete(key);
                return next;
              });
            }),
          ),
        ),
      );

      MutableRef.update(pendingStarts, (pending) => {
        const next = new Map(pending);
        next.set(key, { startAtMs: entry.startAt.getTime(), fiber: sleeper });
        return next;
      });
    });

  const reconcileSchedules: Effect.Effect<
    void,
    never,
    RUser | PollingTag | ProcessScheduleTag | ProcessStore | Clock.Clock
  > = Effect.gen(function* () {
    const schedule = yield* ProcessSchedule;
    const controls = toScheduleControls(schedule);
    const entries = yield* schedule.entries;
    yield* refreshScheduleMirror(entries);
    const materialized = materializeEntries(entries);

    const entryIds = new Set(materialized.map((item) => item.key));
    MutableRef.update(completedEntries, (completed) => {
      const next = new Set<string>();
      for (const id of completed) {
        if (entryIds.has(id)) {
          next.add(id);
        }
      }
      return next;
    });

    const pending = MutableRef.get(pendingStarts);
    for (const [entryId, pendingStart] of pending.entries()) {
      const current = materialized.find((item) => item.key === entryId)?.entry;
      if (
        current === undefined ||
        current.startAt.getTime() !== pendingStart.startAtMs
      ) {
        yield* Fiber.interrupt(pendingStart.fiber);
      }
    }

    const nowMillis = yield* Clock.currentTimeMillis;
    for (const { key, entry } of materialized) {
      if (MutableRef.get(completedEntries).has(key)) {
        continue;
      }
      if (MutableRef.get(runningByEntry).has(key)) {
        continue;
      }
      const startMs = entry.startAt.getTime();
      if (startMs <= nowMillis) {
        const stillValid = Option.match(entry.stopAt, {
          onNone: () => true,
          onSome: (stopAt) => stopAt.getTime() > nowMillis,
        });
        if (stillValid) {
          yield* spawnEntryInstance(key, entry, controls);
        } else {
          MutableRef.update(completedEntries, (completed) => {
            const next = new Set(completed);
            next.add(key);
            return next;
          });
        }
        continue;
      }

      const pendingStart = MutableRef.get(pendingStarts).get(key);
      if (pendingStart === undefined) {
        yield* scheduleFutureEntry(key, entry, controls);
      }
    }
  });

  const supervisedCore: Effect.Effect<
    void,
    never,
    RUser | PollingTag | ProcessScheduleTag | ProcessStore | Clock.Clock
  > = Effect.gen(function* () {
    const schedule = yield* ProcessSchedule;
    const controls = toScheduleControls(schedule);
    if (state.scheduleInitializer !== undefined) {
      yield* state.scheduleInitializer(controls);
    }
    for (;;) {
      yield* reconcileSchedules;
      yield* schedule.changed;
    }
  });

  const getStatus = (dateRange?: {
    start: Date;
    end: Date;
  }): Effect.Effect<ProcessDetails, never, ProcessStore> =>
    Effect.gen(function* () {
      const store = yield* ProcessStore;
      const allExecutions = yield* store.getProcessExecutions(name);
      const inRange = dateRange === undefined
        ? allExecutions
        : allExecutions.filter(
            (event) =>
              event.execution.startedAt >= dateRange.start &&
              event.execution.startedAt <= dateRange.end,
          );
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
        activeInstances: MutableRef.get(mirror.activeInstances),
        nextTriggerRun: MutableRef.get(mirror.nextTriggerRun),
      };
    });

  const runImmediately = (): Effect.Effect<void, never, RUser | ProcessStore> =>
    Effect.gen(function* () {
      yield* Effect.logInfo(
        `🚀 Running '${name}' immediately (tracked; independent of trigger)...`,
      );
      yield* trackedProgram(Option.none(), noScheduleControls);
      yield* Effect.logDebug(`✅ Completed immediate run of '${name}'`);
    });

  const base = {
    name,
    type: "managed" as const,
    getStatus,
    runImmediately,
  };

  if (state.pollingLayer !== undefined && state.scheduleLayer !== undefined) {
    return {
      ...base,
      effect: provideStepLayers(supervisedCore, state),
    };
  }
  if (state.pollingLayer !== undefined) {
    return {
      ...base,
      effect: provideStepLayers(supervisedCore, state),
    };
  }
  if (state.scheduleLayer !== undefined) {
    return {
      ...base,
      effect: provideStepLayers(supervisedCore, state),
    };
  }
  return {
    ...base,
    effect: provideStepLayers(supervisedCore, state),
  };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Services still required at the fork site for {@link Process.effect} /
 * {@link Process.runImmediately} for a given {@link ProcessMakeConfig}.
 *
 * @public
 */
export type ProcessSupervisorRequirements<C extends ProcessMakeConfig<any, any>> =
  C extends ProcessMakeConfig<infer _E, infer RUser>
    ? RUser
    : never;

/**
 * Configuration for {@link Process.make}.
 *
 * @public
 */
export interface ProcessMakeConfig<E, RUser> {
  readonly name: string;
  readonly effect: Effect.Effect<void, E, RUser>;
  /** Optional polling layer for in-instance repeat cadence. */
  readonly polling?: AnyPollingLayer;
  /**
   * Optional schedule initializer that runs once on process start.
   *
   * Use this for async bootstrapping (DB/API) and setting initial windows.
   */
  readonly schedule?: ProcessScheduleInitializer<RUser> | AnyScheduleLayer;
  /**
   * Optional schedule service layer; defaults to in-memory schedule storage.
   */
  readonly scheduleLayer?: AnyScheduleLayer;
}

/**
 * Create a managed {@link Process}.
 *
 * @public
 */
function make<E, RUser>(
  config: ProcessMakeConfig<E, RUser>,
): Process<RUser> {
  const scheduleInitializer = typeof config.schedule === "function"
    ? config.schedule
    : undefined;
  const scheduleLayer = config.scheduleLayer
    ?? (typeof config.schedule === "function"
      ? ProcessSchedule.inMemory()
      : config.schedule)
    ?? ProcessSchedule.inMemory();
  if (config.polling !== undefined) {
    return createProcess({
      name: config.name,
      userEffect: config.effect,
      pollingLayer: config.polling,
      scheduleLayer,
      scheduleInitializer,
    });
  }
  return createProcess({
    name: config.name,
    userEffect: config.effect,
    scheduleLayer,
    scheduleInitializer,
  });
}

/**
 * Attach a {@link Polling} layer after defining base config.
 *
 * @public
 */
function providePolling<E, RUser>(
  base: ProcessMakeConfig<E, RUser>,
  layer: AnyPollingLayer,
): Process<RUser>;
function providePolling<E, RUser>(
  base: ProcessMakeConfig<E, RUser>,
  layer: AnyPollingLayer,
): Process<RUser> {
  const scheduleInitializer = typeof base.schedule === "function"
    ? base.schedule
    : undefined;
  const scheduleLayer = base.scheduleLayer
    ?? (typeof base.schedule === "function"
      ? ProcessSchedule.inMemory()
      : base.schedule)
    ?? ProcessSchedule.inMemory();
  return createProcess({
    name: base.name,
    userEffect: base.effect,
    pollingLayer: layer,
    scheduleLayer,
    scheduleInitializer,
  });
}

/**
 * Attach a {@link ProcessSchedule} layer after defining base config.
 *
 * @public
 */
function provideSchedule<E, RUser>(
  base: ProcessMakeConfig<E, RUser>,
  layer: AnyScheduleLayer,
): Process<RUser>;
function provideSchedule<E, RUser>(
  base: ProcessMakeConfig<E, RUser>,
  layer: AnyScheduleLayer,
): Process<RUser> {
  const pollingLayer = base.polling;
  const scheduleInitializer = typeof base.schedule === "function"
    ? base.schedule
    : undefined;
  if (pollingLayer !== undefined) {
    return createProcess({
      name: base.name,
      userEffect: base.effect,
      pollingLayer,
      scheduleLayer: layer,
      scheduleInitializer,
    });
  }
  return createProcess({
    name: base.name,
    userEffect: base.effect,
    scheduleLayer: layer,
    scheduleInitializer,
  });
}

/**
 * @public
 */
export const Process = {
  make,
  providePolling,
  provideSchedule,
  currentScheduleId,
  scheduleControls,
} as const;

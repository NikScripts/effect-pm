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

import { Cause, Clock, Context, DateTime, Duration, Effect, Fiber, Layer, MutableRef, Option } from "effect";
import { isPollingLayer, isScheduleLayer } from "./processLayerBrand.js";
import { ProcessStore } from "./ProcessStore";
import { Polling, PollingTag } from "./Polling";
import { ProcessSchedule, ProcessScheduleTag } from "./ProcessSchedule";
import type {
  ProcessScheduleEntry,
  ProcessScheduleService,
} from "./ProcessSchedule";
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
   * ProcessStore is optional — analytics are recorded when available, silently skipped when absent.
   */
  readonly effect: Effect.Effect<void, never, R>;
  readonly getStatus: (dateRange?: {
    start: Date;
    end: Date;
  }) => Effect.Effect<ProcessDetails>;
  /**
   * Runs the user `effect` once with tracking, independent of trigger cadence.
   * ProcessStore is optional — execution is tracked when available.
   */
  readonly runImmediately: () => Effect.Effect<void, never, R>;
}

/**
 * Canonical process declaration that can be registered with a typed
 * {@link ProcessGroup}.
 *
 * @remarks
 * The declaration carries the process handle under {@link process} rather than
 * copying handle fields onto the service class. Function/class `name` is a
 * read-only JavaScript property, so storing the runtime handle separately keeps
 * the service class safe while preserving the canonical process id.
 *
 * @public
 */
export interface ProcessDefinition<out Id extends string, out R>
{
  readonly id: Id;
  readonly kind: "process";
  readonly process: Process<R>;
}

/**
 * Canonical process service declaration.
 *
 * @remarks
 * This mirrors Effect's class-based `Context.Service` style while attaching the
 * metadata `ProcessGroup` needs for typed registration and contract generation.
 *
 * @public
 */
export interface ProcessServiceDefinition<Self, Id extends string, R>
  extends Context.ServiceClass<Self, Id, Process<R>>,
    ProcessDefinition<Id, R> {
  readonly tag: Context.Key<Self, Process<R>>;
  readonly layer: Layer.Layer<Self>;
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
 * - `Process.make(id, { schedule: (controls) => ... })`
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

/** @public Optional polling layer argument to {@link Process.make}. */
export type ProcessPollingInput = Layer.Layer<PollingTag, never, never>;

/** @public Optional schedule layer argument to {@link Process.make}. */
export type ProcessScheduleLayerInput = Layer.Layer<ProcessScheduleTag, never, never>;

/** @public Optional schedule layer or initializer argument to {@link Process.make}. */
export type ProcessScheduleInput<R = never> =
  | ProcessScheduleLayerInput
  | ProcessScheduleInitializer<R>;

type AnyPollingLayer = ProcessPollingInput;
type AnyScheduleLayer = ProcessScheduleLayerInput;

type ProcessMakeLayerArg<RUser> =
  | AnyPollingLayer
  | AnyScheduleLayer
  | ProcessScheduleInitializer<RUser>;

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
      return yield* Effect.provide(step, context);
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
    readonly startedAt: number;
    readonly completedAt: number;
    readonly status: "completed" | "failed" | "interrupted";
    readonly error?: unknown;
    readonly isStartupRun: boolean;
  }): Effect.Effect<void> =>
    Effect.gen(function* () {
      const storeOption = yield* Effect.serviceOption(ProcessStore);
      if (Option.isNone(storeOption)) return;
      executionRecordId += 1;
      yield* storeOption.value.append({
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
            args.completedAt - args.startedAt,
          ),
          status: args.status,
          error: args.error === undefined ? undefined : String(args.error),
          isStartupRun: args.isStartupRun,
        },
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning(`ProcessStore write failed for process "${name}" execution event`).pipe(
            Effect.annotateLogs("cause", Cause.pretty(cause)),
          )
        ),
      );
    });

  const trackedProgram = (
    scheduleIdentifier: Option.Option<string>,
    controls: ProcessScheduleControls,
  ): Effect.Effect<void, never, RUser> =>
    Effect.gen(function* () {
      const storeOption = yield* Effect.serviceOption(ProcessStore);
      const executedAt = yield* Clock.currentTimeMillis;
      const isStartupRun = Option.isSome(storeOption)
        ? (yield* storeOption.value.getProcessExecutions(name, { limit: 1 })).length === 0
        : true;

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
              const completedAt = yield* Clock.currentTimeMillis;
              yield* recordExecutionEvent({
                scheduleKey: Option.getOrNull(scheduleIdentifier),
                startedAt: executedAt,
                completedAt,
                status: "failed",
                error,
                isStartupRun,
              });
              yield* Effect.logError(
                `❌ Process '${name}' run failed at ${String(executedAt)}: ${String(error)}`,
              );
            }),
          onSuccess: () =>
            Effect.gen(function* () {
              const completedAt = yield* Clock.currentTimeMillis;
              yield* recordExecutionEvent({
                scheduleKey: Option.getOrNull(scheduleIdentifier),
                startedAt: executedAt,
                completedAt,
                status: "completed",
                isStartupRun,
              });
              yield* Effect.logDebug(
                `✅ Process '${name}' run completed at ${String(executedAt)}`,
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
  ): Effect.Effect<void, never, RUser | PollingTag | ProcessScheduleTag | Clock.Clock> =>
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
  ): Effect.Effect<void, never, RUser | PollingTag | ProcessScheduleTag | Clock.Clock> =>
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
    RUser | PollingTag | ProcessScheduleTag | Clock.Clock
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
    RUser | PollingTag | ProcessScheduleTag | Clock.Clock
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
  }): Effect.Effect<ProcessDetails> =>
    Effect.gen(function* () {
      const storeOption = yield* Effect.serviceOption(ProcessStore);
      const allExecutions = Option.isSome(storeOption)
        ? yield* storeOption.value.getProcessExecutions(name)
        : [];
      const inRange = dateRange === undefined
        ? allExecutions
        : allExecutions.filter(
            (event) =>
              event.execution.startedAt >= dateRange.start.getTime() &&
              event.execution.startedAt <= dateRange.end.getTime(),
          );
      const lastRunMillis = allExecutions[0]?.execution.startedAt;
      const lastRun =
        lastRunMillis === undefined
          ? null
          : DateTime.toDateUtc(DateTime.makeUnsafe(lastRunMillis));
      const executions = inRange.length;
      const firstStartupMillis =
        allExecutions.find((event) => event.execution.isStartupRun)?.execution
          .startedAt;
      const firstStartup =
        firstStartupMillis === undefined
          ? null
          : DateTime.toDateUtc(DateTime.makeUnsafe(firstStartupMillis));

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

  const runImmediately = (): Effect.Effect<void, never, RUser> =>
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
// `E` is covariant in `Effect.Effect<void, E, RUser>` (top = `unknown`),
// `RUser` is contravariant (top = `never`); using these as the upper bound
// makes the constraint variance-correct without resorting to `any`.
export type ProcessSupervisorRequirements<C extends ProcessMakeOptions<unknown, never>> =
  C extends ProcessMakeOptions<infer _E, infer RUser>
    ? RUser
    : never;

/**
 * Configuration for {@link Process.make} when using the config-object form (id is separate).
 *
 * @public
 */
export interface ProcessMakeOptions<E, RUser> {
  readonly effect: Effect.Effect<void, E, RUser>;
  /** Optional polling layer for in-instance repeat cadence. */
  readonly polling?: AnyPollingLayer;
  /**
   * Optional schedule layer or initializer.
   *
   * When omitted, defaults to {@link ProcessSchedule.alwaysArmed}. Use
   * {@link ProcessSchedule.empty} or {@link ProcessSchedule.inMemory} for an
   * empty store (disarmed until entries are added).
   */
  readonly schedule?: ProcessScheduleInitializer<RUser> | AnyScheduleLayer;
  /**
   * Explicit schedule service layer. When set, takes precedence over `schedule`.
   *
   * When both `schedule` and `scheduleLayer` are omitted,
   * {@link ProcessSchedule.alwaysArmed} is used.
   */
  readonly scheduleLayer?: AnyScheduleLayer;
}

/** @internal Resolved id + {@link ProcessMakeOptions} for supervisor wiring. */
export type ProcessMakeConfig<E, RUser> = ProcessMakeOptions<E, RUser> & {
  readonly name: string;
};

const resolveScheduleLayer = <E, RUser>(
  config: Pick<ProcessMakeOptions<E, RUser>, "schedule" | "scheduleLayer">,
): AnyScheduleLayer => {
  if (config.scheduleLayer !== undefined) {
    return config.scheduleLayer;
  }
  if (typeof config.schedule === "function") {
    return ProcessSchedule.inMemory();
  }
  if (config.schedule !== undefined) {
    return config.schedule;
  }
  return ProcessSchedule.alwaysArmed;
};

const buildProcess = <E, RUser>(
  name: string,
  config: ProcessMakeOptions<E, RUser>,
): Process<RUser> => {
  const scheduleInitializer = typeof config.schedule === "function"
    ? config.schedule
    : undefined;
  const scheduleLayer = resolveScheduleLayer(config);
  if (config.polling !== undefined) {
    return createProcess({
      name,
      userEffect: config.effect,
      pollingLayer: config.polling,
      scheduleLayer,
      scheduleInitializer,
    });
  }
  return createProcess({
    name,
    userEffect: config.effect,
    scheduleLayer,
    scheduleInitializer,
  });
};

const collectPollingAndSchedule = <RUser>(
  third?: ProcessMakeLayerArg<RUser>,
  fourth?: ProcessMakeLayerArg<RUser>,
): Pick<ProcessMakeOptions<never, RUser>, "polling" | "schedule" | "scheduleLayer"> => {
  let polling: AnyPollingLayer | undefined;
  let schedule: ProcessScheduleInitializer<RUser> | undefined;
  let scheduleLayer: AnyScheduleLayer | undefined;

  for (const arg of [third, fourth]) {
    if (arg === undefined) {
      continue;
    }
    if (typeof arg === "function") {
      schedule = arg;
      continue;
    }
    if (isPollingLayer(arg)) {
      polling = arg as AnyPollingLayer;
      continue;
    }
    if (isScheduleLayer(arg)) {
      scheduleLayer = arg as AnyScheduleLayer;
    }
  }

  return {
    ...(polling !== undefined ? { polling } : {}),
    ...(schedule !== undefined ? { schedule } : {}),
    ...(scheduleLayer !== undefined ? { scheduleLayer } : {}),
  };
};

const resolveProcessMakeConfig = <E, RUser>(
  effectOrConfig: Effect.Effect<void, E, RUser> | ProcessMakeOptions<E, RUser>,
  third?: ProcessMakeLayerArg<RUser>,
  fourth?: ProcessMakeLayerArg<RUser>,
): ProcessMakeOptions<E, RUser> => {
  if (Effect.isEffect(effectOrConfig)) {
    return {
      effect: effectOrConfig,
      ...collectPollingAndSchedule(third, fourth),
    };
  }
  return effectOrConfig;
};

/**
 * Create a managed {@link Process}.
 *
 * @public
 */
function make<const Id extends string, E, RUser>(
  id: Id,
  effect: Effect.Effect<void, E, RUser>,
): Process<RUser>;
function make<const Id extends string, E, RUser>(
  id: Id,
  effect: Effect.Effect<void, E, RUser>,
  polling: AnyPollingLayer,
): Process<RUser>;
function make<const Id extends string, E, RUser>(
  id: Id,
  effect: Effect.Effect<void, E, RUser>,
  schedule: AnyScheduleLayer,
): Process<RUser>;
function make<const Id extends string, E, RUser, RSchedule>(
  id: Id,
  effect: Effect.Effect<void, E, RUser>,
  schedule: ProcessScheduleInitializer<RSchedule>,
): Process<RUser | RSchedule>;
function make<const Id extends string, E, RUser>(
  id: Id,
  effect: Effect.Effect<void, E, RUser>,
  polling: AnyPollingLayer,
  schedule: AnyScheduleLayer,
): Process<RUser>;
function make<const Id extends string, E, RUser, RSchedule>(
  id: Id,
  effect: Effect.Effect<void, E, RUser>,
  polling: AnyPollingLayer,
  schedule: ProcessScheduleInitializer<RSchedule>,
): Process<RUser | RSchedule>;
function make<const Id extends string, E, RUser>(
  id: Id,
  effect: Effect.Effect<void, E, RUser>,
  schedule: AnyScheduleLayer,
  polling: AnyPollingLayer,
): Process<RUser>;
function make<const Id extends string, E, RUser, RSchedule>(
  id: Id,
  effect: Effect.Effect<void, E, RUser>,
  schedule: ProcessScheduleInitializer<RSchedule>,
  polling: AnyPollingLayer,
): Process<RUser | RSchedule>;
function make<const Id extends string, E, RUser>(
  id: Id,
  config: ProcessMakeOptions<E, RUser>,
): Process<RUser>;
function make<const Id extends string, E, RUser>(
  id: Id,
  effectOrConfig: Effect.Effect<void, E, RUser> | ProcessMakeOptions<E, RUser>,
  third?: ProcessMakeLayerArg<RUser>,
  fourth?: ProcessMakeLayerArg<RUser>,
): Process<RUser> {
  return buildProcess(id, resolveProcessMakeConfig(effectOrConfig, third, fourth));
}

/** @public */
export type ProcessMake = typeof make;

const processDefinitionKind = "process" as const;

const makeProcessDefinition = <const Id extends string, E, RUser>(
  id: Id,
  config: ProcessMakeOptions<E, RUser>,
): ProcessDefinition<Id, RUser> => {
  const process = make(id, config);
  return {
    id,
    kind: processDefinitionKind,
    process,
  };
};

const defineProcessService = <Self>() => {
  function service<const Id extends string, E, RUser>(
    id: Id,
    effect: Effect.Effect<void, E, RUser>,
  ): ProcessServiceDefinition<Self, Id, RUser>;
  function service<const Id extends string, E, RUser>(
    id: Id,
    effect: Effect.Effect<void, E, RUser>,
    polling: AnyPollingLayer,
  ): ProcessServiceDefinition<Self, Id, RUser>;
  function service<const Id extends string, E, RUser>(
    id: Id,
    effect: Effect.Effect<void, E, RUser>,
    schedule: AnyScheduleLayer,
  ): ProcessServiceDefinition<Self, Id, RUser>;
  function service<const Id extends string, E, RUser, RSchedule>(
    id: Id,
    effect: Effect.Effect<void, E, RUser>,
    schedule: ProcessScheduleInitializer<RSchedule>,
  ): ProcessServiceDefinition<Self, Id, RUser | RSchedule>;
  function service<const Id extends string, E, RUser>(
    id: Id,
    effect: Effect.Effect<void, E, RUser>,
    polling: AnyPollingLayer,
    schedule: AnyScheduleLayer,
  ): ProcessServiceDefinition<Self, Id, RUser>;
  function service<const Id extends string, E, RUser, RSchedule>(
    id: Id,
    effect: Effect.Effect<void, E, RUser>,
    polling: AnyPollingLayer,
    schedule: ProcessScheduleInitializer<RSchedule>,
  ): ProcessServiceDefinition<Self, Id, RUser | RSchedule>;
  function service<const Id extends string, E, RUser>(
    id: Id,
    effect: Effect.Effect<void, E, RUser>,
    schedule: AnyScheduleLayer,
    polling: AnyPollingLayer,
  ): ProcessServiceDefinition<Self, Id, RUser>;
  function service<const Id extends string, E, RUser, RSchedule>(
    id: Id,
    effect: Effect.Effect<void, E, RUser>,
    schedule: ProcessScheduleInitializer<RSchedule>,
    polling: AnyPollingLayer,
  ): ProcessServiceDefinition<Self, Id, RUser | RSchedule>;
  function service<const Id extends string, E, RUser>(
    id: Id,
    config: ProcessMakeOptions<E, RUser>,
  ): ProcessServiceDefinition<Self, Id, RUser>;
  function service<const Id extends string, E, RUser>(
    id: Id,
    effectOrConfig: Effect.Effect<void, E, RUser> | ProcessMakeOptions<E, RUser>,
    third?: ProcessMakeLayerArg<RUser>,
    fourth?: ProcessMakeLayerArg<RUser>,
  ): ProcessServiceDefinition<Self, Id, RUser> {
    const process = makeProcessDefinition(
      id,
      resolveProcessMakeConfig(effectOrConfig, third, fourth),
    );
    const base = Context.Service<Self, Process<RUser>>()(id);
    return Object.assign(base, {
      ...process,
      tag: base,
      layer: Layer.succeed(base, process.process),
    });
  }
  return service;
};

/** @public */
export type ProcessServiceBuilder<Self> = ReturnType<typeof defineProcessService<Self>>;

/** @public */
export type ProcessServiceFactory = typeof defineProcessService;

/**
 * Managed process factories and schedule helpers.
 *
 * @remarks
 * - **`make`** — construct a {@link Process} from an `effect`, optional `polling` / `schedule`
 *   layers in any order, or a config object.
 * - **`currentScheduleId` / `scheduleControls`** — ergonomic access to schedule metadata and
 *   mutators from inside a running process instance.
 *
 * @public
 */
export const Process = {
  make,
  Service: defineProcessService,
  currentScheduleId,
  scheduleControls,
} as const;

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
 * ## Execution analytics (toolkit `layer` path)
 *
 * When an app provides **`StoreScopeBridgeTag`** (via `Store.Service.layerMemory` or the
 * built-in default store layer) and registers **`Process.store(tag)`**, finished runs append to
 * the built-in execution contract via **`Process.store(tag)`**.
 *
 * ## Two surfaces, one namespace
 *
 * This module is consumed as an Effect **module namespace** (`export * as Process`), so member
 * access tree-shakes. It carries two cooperating surfaces:
 * - **Engine** — {@link make} (+ {@link Service}, {@link currentScheduleId}, {@link scheduleControls},
 *   {@link Errors}): construct and run a supervised process directly.
 * - **Resource toolkit** — {@link Tag} / {@link Schedule} / {@link schedule} shape a process as a
 *   {@link Resource}; declare optional {@link ProcessTagOptions.success} and
 *   {@link ProcessTagOptions.error} on {@link Tag} (positional or config object). Use
 *   {@link layer} / {@link serve} / {@link serveRemote} / {@link configure} to run it locally or over
 *   toolkit's location-transparent layers (the same `yield* Tag` runs local or remote; only the layer
 *   changes). This mirrors `QueueResource`: the light `Process.Tag` path pulls no engine code, and the
 *   engine loads only when a runtime verb (`make` / `layer` / `serve`) is referenced.
 *
 * @module Process
 */

import {
  Clock,
  Context,
  Data,
  DateTime,
  Duration,
  Effect,
  Fiber,
  Layer,
  Logger,
  MutableRef,
  Option,
  PubSub,
  Ref,
  Schema,
  Scope,
  Stream,
  SubscriptionRef,
} from "effect";
import {
  configureLayer,
  configureWrapEffectField,
  foldConfiguredSpec,
  type ConfigPatch,
} from "./ResourceConfigure";
import { isPollingLayer, isScheduleLayer } from "./internal/processLayerBrand";
import {
  makeProcessExecutionEvent,
  processEventReadPayload,
  processExecutionEventVoid,
} from "./internal/processEvent";
import {
  errorOf,
  errorSym,
  successOf,
  successSym,
} from "./internal/processTagSchemas";
import { LogAnnotationKeys, withProcessLogAnnotations } from "./LogContext";
import { Polling, PollingTag } from "./Polling";
import { ProcessSchedule, ProcessScheduleTag } from "./internal/processSchedule";
import type {
  ProcessScheduleEntry,
  ProcessScheduleService,
  ReconcileResult,
  ScheduleDefineApi,
} from "./internal/processSchedule";
// ── toolkit (Resource) surface — the light contract + heavy layers assembled into `Process` ──
import * as LogLevel from "effect/LogLevel";
import { CurrentLogAnnotations, CurrentLogSpans } from "effect/References";
import * as Resource from "./Resource";
import { buildRpcGroup, groupSym, specSym } from "./Resource";
import type {
  FlatSpec,
  HandlerContextOf,
  ImplOf,
  Local,
  Method,
  NodeBoundTag,
  NodeKey,
  RefField,
  ResourceTag,
  Spec,
  Subscribable,
} from "./Resource";
import { HistoryStore } from "./HistoryStore";
import { LogEntrySchema, logEntryFromLoggerOptions } from "./LogEntry";
import type { LogEntry } from "./LogEntry";
import { facetStoreRegistration } from "./internal/store/facetStore";
import { StoreScopeBridgeTag } from "./internal/store/bridge";
import { builtInProcessStoreContract, type BuiltInProcessContract } from "./internal/store/processStoreSpec";
import type { StoreScopeTag } from "./internal/store/registration";
import { makeProcessExecutionPersist } from "./internal/processExecutionPersist";
import {
  makeProcessExecutionRecorder,
  type ProcessExecutionRecorder,
} from "./internal/processStoreTap";
import type { StoreShapes } from "./internal/store/contractDef";
// ============================================================================
// Public types
// ============================================================================

/**
 * A one-shot read of a managed process's runtime mirror — the observable state the supervisor
 * maintains as it reconciles the schedule and spawns instances. Native (engine-side) types;
 * the toolkit contract ({@link processStatus}) maps these to its wire form.
 *
 * @public
 */
export interface ProcessSnapshot {
  /** Whether the schedule currently places the process in a run window (derived from entries). */
  readonly armed: boolean;
  /** How many run instances are executing right now. */
  readonly activeInstances: number;
  /** When the next run instance is expected to start (none if disarmed/idle). */
  readonly nextTriggerRun: Option.Option<Date>;
  /** When the schedule next changes armed/disarmed (none if no future transition). */
  readonly nextScheduleTransition: Option.Option<Date>;
  /** The in-instance repeat cadence, when polling is configured (none otherwise). */
  readonly nextPollCadence: Option.Option<Duration.Duration>;
  /** Total effect runs started (scheduled + polling + `runImmediately`) since the layer built. */
  readonly runsStarted: number;
  /** Of those, how many completed successfully. */
  readonly runsSucceeded: number;
  /** Of those, how many failed. */
  readonly runsFailed: number;
  /** When the most recent run started (none if it hasn't run yet). */
  readonly lastRunStartedAt: Option.Option<Date>;
  /** Wall-clock duration of the most recent finished run, in ms (none if none finished). */
  readonly lastRunDurationMillis: Option.Option<number>;
}

/**
 * Managed process handle for the process manager.
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
   * Execution history is recorded on the **`Process.layer`** path via **`Process.store(tag)`**
   * when the app provides **`StoreScopeBridgeTag`**. The direct **`make`** path does not write
   * legacy storage facets.
   */
  readonly effect: Effect.Effect<void, never, R>;
  /**
   * Runs the user `effect` once with tracking, independent of trigger cadence.
   * Same store-only persistence semantics as {@link Process.effect} on the layer path.
   */
  readonly runImmediately: () => Effect.Effect<void, never, R>;
  /**
   * One-shot read of the runtime mirror (armed / active instances / next trigger / next schedule
   * transition / poll cadence). Drives the toolkit contract's `status` ref (`status.get` /
   * `status.changes`). Reads the supervisor's live mirror, so it reflects state regardless of who
   * forked {@link Process.effect}.
   */
  readonly snapshot: Effect.Effect<ProcessSnapshot>;
}

/**
 * Canonical process declaration that can be registered with a typed
 * the process manager.
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
 * metadata the process manager needs for typed registration and contract generation.
 *
 * @public
 */
export interface ProcessServiceDefinition<Self, Id extends string, E, R>
  extends Context.ServiceClass<Self, Id, Process<R>>,
    ProcessDefinition<Id, R> {
  readonly tag: Context.Key<Self, Process<R>>;
  readonly layer: Layer.Layer<Self>;
  /**
   * Factory defaults before {@link configure} layers (see `ResourceConfigure` module).
   */
  readonly defaultSpec: ProcessMakeOptions<E, R>;
  /**
   * Append a configure patch; merge with {@link layer} via `Layer.provideMerge`.
   */
  readonly configure: (
    patch: ConfigPatch<ProcessMakeOptions<E, R>>,
  ) => Layer.Layer<never>;
  /**
   * Patch only the supervised repeat `effect`: `fn(previous) => next`.
   */
  readonly wrapEffect: (
    fn: (
      previous: ProcessMakeOptions<E, R>["effect"],
    ) => ProcessMakeOptions<E, R>["effect"],
  ) => Layer.Layer<never>;
  /**
   * {@link Process} built from {@link defaultSpec} after folding configure patches.
   * the process manager uses this when assembling the group runtime.
   */
  readonly buildConfiguredProcess: Effect.Effect<Process<R>>;
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

/** @public Thrown when a positional {@link Process.make} argument is not a recognized preset layer or schedule initializer. */
export class ProcessMakeInvalidLayerArgument extends Data.TaggedError("ProcessMakeInvalidLayerArgument")<{
  /** 1-based index of the invalid argument (`3` or `4`). */
  readonly argumentIndex: 3 | 4;
  readonly reason: string;
}> {}

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
  // Run metrics — counted once at the single run boundary ({@link trackedProgram}), so they cover
  // scheduled ticks, polling ticks, and `runImmediately` alike.
  readonly runsStarted: MutableRef.MutableRef<number>;
  readonly runsSucceeded: MutableRef.MutableRef<number>;
  readonly runsFailed: MutableRef.MutableRef<number>;
  readonly lastRunStartedAt: MutableRef.MutableRef<Option.Option<Date>>;
  readonly lastRunDurationMillis: MutableRef.MutableRef<Option.Option<number>>;
}

interface ProcessBuildStateBase<E, RUser> {
  readonly name: string;
  readonly userEffect: Effect.Effect<void, E, RUser>;
  readonly scheduleInitializer?: ProcessScheduleInitializer<RUser>;
  /** @internal Store-backed execution history when built via {@link layer}. */
  readonly executionRecorder?: ProcessExecutionRecorder;
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

  const { name, userEffect, executionRecorder } = state;

  const mirror: ProcessMirror = {
    armed: MutableRef.make(false),
    nextScheduleTransition: MutableRef.make<Option.Option<Date>>(Option.none()),
    nextPollCadence: MutableRef.make<Option.Option<Duration.Duration>>(Option.none()),
    activeInstances: MutableRef.make(0),
    nextTriggerRun: MutableRef.make<Option.Option<Date>>(Option.none()),
    runsStarted: MutableRef.make(0),
    runsSucceeded: MutableRef.make(0),
    runsFailed: MutableRef.make(0),
    lastRunStartedAt: MutableRef.make<Option.Option<Date>>(Option.none()),
    lastRunDurationMillis: MutableRef.make<Option.Option<number>>(Option.none()),
  };

  const executionPersist = makeProcessExecutionPersist({
    recorder: executionRecorder,
  });

  const recordExecutionCompleted = executionPersist.recordCompleted;
  const recordExecutionFailed = executionPersist.recordFailed;
  const readHasPriorExecutions = executionPersist.hasPriorExecutions;

  const trackedProgram = (
    scheduleIdentifier: Option.Option<string>,
    controls: ProcessScheduleControls,
  ): Effect.Effect<void, never, RUser> =>
    Effect.gen(function* () {
      const executedAt = yield* Clock.currentTimeMillis;
      MutableRef.update(mirror.runsStarted, (n) => n + 1);
      MutableRef.set(
        mirror.lastRunStartedAt,
        Option.some(DateTime.toDateUtc(DateTime.makeUnsafe(executedAt))),
      );
      const hasPrior = yield* readHasPriorExecutions();
      const isStartupRun = !hasPrior;

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
              MutableRef.update(mirror.runsFailed, (n) => n + 1);
              MutableRef.set(
                mirror.lastRunDurationMillis,
                Option.some(completedAt - executedAt),
              );
              yield* recordExecutionFailed({
                scheduleKey: Option.getOrNull(scheduleIdentifier),
                startedAt: executedAt,
                completedAt,
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
              MutableRef.update(mirror.runsSucceeded, (n) => n + 1);
              MutableRef.set(
                mirror.lastRunDurationMillis,
                Option.some(completedAt - executedAt),
              );
              yield* recordExecutionCompleted({
                scheduleKey: Option.getOrNull(scheduleIdentifier),
                startedAt: executedAt,
                completedAt,
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

  const runImmediately = (): Effect.Effect<void, never, RUser> =>
    Effect.gen(function* () {
      yield* Effect.logInfo(
        `🚀 Running '${name}' immediately (tracked; independent of trigger)...`,
      );
      yield* trackedProgram(Option.none(), noScheduleControls);
      yield* Effect.logDebug(`✅ Completed immediate run of '${name}'`);
    });

  const snapshot: Effect.Effect<ProcessSnapshot> = Effect.sync(() => ({
    armed: MutableRef.get(mirror.armed),
    activeInstances: MutableRef.get(mirror.activeInstances),
    nextTriggerRun: MutableRef.get(mirror.nextTriggerRun),
    nextScheduleTransition: MutableRef.get(mirror.nextScheduleTransition),
    nextPollCadence: MutableRef.get(mirror.nextPollCadence),
    runsStarted: MutableRef.get(mirror.runsStarted),
    runsSucceeded: MutableRef.get(mirror.runsSucceeded),
    runsFailed: MutableRef.get(mirror.runsFailed),
    lastRunStartedAt: MutableRef.get(mirror.lastRunStartedAt),
    lastRunDurationMillis: MutableRef.get(mirror.lastRunDurationMillis),
  }));

  const base = {
    name,
    type: "managed" as const,
    runImmediately,
    snapshot,
  };

  const annotateProcessLogs = (
    effect: Effect.Effect<void, never, RUser | PollingTag | ProcessScheduleTag | Clock.Clock>,
  ): Effect.Effect<void, never, RUser | PollingTag | ProcessScheduleTag | Clock.Clock> =>
    Effect.annotateLogs(effect, {
      [LogAnnotationKeys.processId]: name,
    });

  if (state.pollingLayer !== undefined && state.scheduleLayer !== undefined) {
    return {
      ...base,
      effect: annotateProcessLogs(provideStepLayers(supervisedCore, state)),
    };
  }
  if (state.pollingLayer !== undefined) {
    return {
      ...base,
      effect: annotateProcessLogs(provideStepLayers(supervisedCore, state)),
    };
  }
  if (state.scheduleLayer !== undefined) {
    return {
      ...base,
      effect: annotateProcessLogs(provideStepLayers(supervisedCore, state)),
    };
  }
  return {
    ...base,
    effect: annotateProcessLogs(provideStepLayers(supervisedCore, state)),
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
  /**
   * @internal Wired by {@link layer} for store-backed execution history.
   * Not part of the public {@link make} API.
   */
  readonly _executionRecorder?: ProcessExecutionRecorder;
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
      executionRecorder: config._executionRecorder,
    });
  }
  return createProcess({
    name,
    userEffect: config.effect,
    scheduleLayer,
    scheduleInitializer,
    executionRecorder: config._executionRecorder,
  });
};

const collectPollingAndSchedule = <RUser>(
  third?: ProcessMakeLayerArg<RUser>,
  fourth?: ProcessMakeLayerArg<RUser>,
): Pick<ProcessMakeOptions<never, RUser>, "polling" | "schedule" | "scheduleLayer"> => {
  let polling: AnyPollingLayer | undefined;
  let schedule: ProcessScheduleInitializer<RUser> | undefined;
  let scheduleLayer: AnyScheduleLayer | undefined;

  const fail = (argumentIndex: 3 | 4, reason: string): never => {
    throw new ProcessMakeInvalidLayerArgument({ argumentIndex, reason });
  };

  for (const [index, arg] of [[3, third], [4, fourth]] as const) {
    if (arg === undefined) {
      continue;
    }
    if (typeof arg === "function") {
      if (schedule !== undefined) {
        fail(index, "only one schedule initializer is allowed");
      }
      schedule = arg;
      continue;
    }
    if (isPollingLayer(arg)) {
      if (polling !== undefined) {
        fail(index, "only one polling layer is allowed");
      }
      polling = arg;
      continue;
    }
    if (isScheduleLayer(arg)) {
      if (scheduleLayer !== undefined) {
        fail(index, "only one schedule layer is allowed");
      }
      scheduleLayer = arg;
      continue;
    }
    if (Layer.isLayer(arg)) {
      fail(
        index,
        "custom Layer values are not supported as positional arguments; pass polling and schedule on the config object instead",
      );
    }
    fail(
      index,
      "expected a Polling preset layer, ProcessSchedule preset layer, or schedule initializer function",
    );
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
  ): ProcessServiceDefinition<Self, Id, E, RUser>;
  function service<const Id extends string, E, RUser>(
    id: Id,
    effect: Effect.Effect<void, E, RUser>,
    polling: AnyPollingLayer,
  ): ProcessServiceDefinition<Self, Id, E, RUser>;
  function service<const Id extends string, E, RUser>(
    id: Id,
    effect: Effect.Effect<void, E, RUser>,
    schedule: AnyScheduleLayer,
  ): ProcessServiceDefinition<Self, Id, E, RUser>;
  function service<const Id extends string, E, RUser, RSchedule>(
    id: Id,
    effect: Effect.Effect<void, E, RUser>,
    schedule: ProcessScheduleInitializer<RSchedule>,
  ): ProcessServiceDefinition<Self, Id, E, RUser | RSchedule>;
  function service<const Id extends string, E, RUser>(
    id: Id,
    effect: Effect.Effect<void, E, RUser>,
    polling: AnyPollingLayer,
    schedule: AnyScheduleLayer,
  ): ProcessServiceDefinition<Self, Id, E, RUser>;
  function service<const Id extends string, E, RUser, RSchedule>(
    id: Id,
    effect: Effect.Effect<void, E, RUser>,
    polling: AnyPollingLayer,
    schedule: ProcessScheduleInitializer<RSchedule>,
  ): ProcessServiceDefinition<Self, Id, E, RUser | RSchedule>;
  function service<const Id extends string, E, RUser>(
    id: Id,
    effect: Effect.Effect<void, E, RUser>,
    schedule: AnyScheduleLayer,
    polling: AnyPollingLayer,
  ): ProcessServiceDefinition<Self, Id, E, RUser>;
  function service<const Id extends string, E, RUser, RSchedule>(
    id: Id,
    effect: Effect.Effect<void, E, RUser>,
    schedule: ProcessScheduleInitializer<RSchedule>,
    polling: AnyPollingLayer,
  ): ProcessServiceDefinition<Self, Id, E, RUser | RSchedule>;
  function service<const Id extends string, E, RUser>(
    id: Id,
    config: ProcessMakeOptions<E, RUser>,
  ): ProcessServiceDefinition<Self, Id, E, RUser>;
  function service<const Id extends string, E, RUser>(
    id: Id,
    effectOrConfig: Effect.Effect<void, E, RUser> | ProcessMakeOptions<E, RUser>,
    third?: ProcessMakeLayerArg<RUser>,
    fourth?: ProcessMakeLayerArg<RUser>,
  ): ProcessServiceDefinition<Self, Id, E, RUser> {
    const defaultSpec = resolveProcessMakeConfig(effectOrConfig, third, fourth);
    const process = makeProcessDefinition(id, defaultSpec);
    const buildConfiguredProcess = foldConfiguredSpec(id, defaultSpec).pipe(
      Effect.map((effective) => make(id, effective)),
    );
    const base = Context.Service<Self, Process<RUser>>()(id);
    return Object.assign(base, {
      ...process,
      tag: base,
      defaultSpec,
      configure: (patch: ConfigPatch<ProcessMakeOptions<E, RUser>>) =>
        configureLayer(id, patch),
      wrapEffect: (
        fn: (
          previous: ProcessMakeOptions<E, RUser>["effect"],
        ) => ProcessMakeOptions<E, RUser>["effect"],
      ) => configureWrapEffectField(id, fn),
      buildConfiguredProcess,
      layer: Layer.effect(base)(buildConfiguredProcess),
    });
  }
  return service;
};

/** @public */
export type ProcessServiceBuilder<Self> = ReturnType<typeof defineProcessService<Self>>;

/** @public */
export type ProcessServiceFactory = typeof defineProcessService;

// ============================================================================
// Engine surface (top-level exports)
//
// `Process` is a module namespace (Effect-style — the barrel does `export * as Process`), so the
// engine helpers here and the Resource toolkit below are all its members: `Process.make`,
// `Process.Service`, `Process.currentScheduleId`, `Process.scheduleControls`, `Process.Tag`,
// `Process.schedule`, `Process.layer`, … Member access tree-shakes — a `Process.Tag`-only consumer
// pulls no engine code, mirroring `QueueResource`.
// ============================================================================

export { make };
export { defineProcessService as Service };

/**
 * Engine errors thrown by {@link make}.
 *
 * @public
 */
export const Errors = {
  ProcessMakeInvalidLayerArgument,
} as const;

// ############################################################################
// #                                                                          #
// #  Resource toolkit — the light contract (schemas / specs / combinators /  #
// #  Tag / Schedule) plus the heavy layers (layer / serve / serveRemote).    #
// #  A process is a Resource: driven locally or remotely over RPC through    #
// #  the toolkit's location-transparent layers, exactly like QueueResource.  #
// #                                                                          #
// ############################################################################

// ============================================================================
// Wire schemas
// ============================================================================

/**
 * One scheduled run window on the wire — the wire form of the engine's {@link ProcessScheduleEntry}.
 * The engine models `id` / `stopAt` as `Option` and the times as `Date`; the toolkit standard is
 * `DateTime.Utc` and `optionalKey`, so the runtime maps between them. `startAt` is when the run
 * instance triggers; `stopAt` (absent = open-ended) is when it stops.
 *
 * @public
 */
export const processScheduleEntry = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  startAt: Schema.DateTimeUtc,
  stopAt: Schema.optionalKey(Schema.DateTimeUtc),
});

/**
 * The current-state snapshot of a managed process — the wire form of the engine's
 * {@link ProcessSnapshot} (plus `supervising`). The element of the reactive `status` field:
 * `status.get` reads it once, `status.changes` streams it.
 *
 * @public
 */
export const processStatus = Schema.Struct({
  supervising: Schema.Boolean,
  armed: Schema.Boolean,
  activeInstances: Schema.Number,
  nextTriggerRun: Schema.optionalKey(Schema.DateTimeUtc),
  nextScheduleTransition: Schema.optionalKey(Schema.DateTimeUtc),
  nextPollCadence: Schema.optionalKey(Schema.Duration),
  runsStarted: Schema.Number,
  runsSucceeded: Schema.Number,
  runsFailed: Schema.Number,
  lastRunStartedAt: Schema.optionalKey(Schema.DateTimeUtc),
  lastRunDurationMillis: Schema.optionalKey(Schema.Number),
});

/**
 * A captured log line on the wire — the element of a process's `logs` stream. Reuses the package's
 * structured log schema (`date`, `level`, `message`, `cause?`, `annotations`, `spans`).
 *
 * @public
 */
export const processLogEntry = LogEntrySchema;

/**
 * Read payload for process store `events` queries.
 *
 * @public
 */
export { processEventReadPayload };

/**
 * Execution event union for void processes (no `result` field on `RunCompleted`).
 *
 * @public
 */
export const processExecutionEvent = processExecutionEventVoid;

/** @public */
export type ProcessExecutionEvent = typeof processExecutionEventVoid.Type;

/**
 * Build an execution event union when the process tag carries a {@link ProcessTagOptions.success}.
 *
 * @public
 */
export const processExecutionEventFor = makeProcessExecutionEvent;

/**
 * Payload fields for `logs.history` — newest `limit` entries within an optional `[since, until]`
 * window.
 *
 * @public
 */
export const historyQuery = {
  limit: Schema.optionalKey(Schema.Number),
  since: Schema.optionalKey(Schema.DateTimeUtc),
  until: Schema.optionalKey(Schema.DateTimeUtc),
};

/**
 * This contract's canonical **kind** — stamped on every process tag so consumers (e.g. the
 * dashboard) can classify it via {@link Resource.kindOf} without sniffing the spec.
 *
 * @public
 */
export const kind = "@nikscripts/effect-pm/Process";

/**
 * This contract's canonical **kind** for a standalone {@link Schedule} resource.
 *
 * @public
 */
export const scheduleKind = "@nikscripts/effect-pm/Process/Schedule";

// ============================================================================
// Base process spec (observation + lifecycle — no schedule verbs)
// ============================================================================

/**
 * The **base** process control + observation contract — shared by every process. Mirrors the
 * observable/controllable seams the engine supervisor exposes ({@link ProcessSnapshot} + lifecycle).
 * A base process has **no** schedule mutation verbs: arm/disarm is done by mutating a schedule, so
 * those verbs appear only when a process {@link schedule | owns an inline schedule}.
 *
 * @public
 */
export const processSpec = {
  // ── live current state — one SubscriptionRef-backed source of truth ──
  // `status` is the whole snapshot; `status.get` reads it once, `status.changes` streams every
  // change (uniform local + remote), mirroring the queue's `status` ref.
  status: Resource.ref(processStatus).annotate({
    description:
      "Live current-state snapshot: supervising, armed, active instances, next trigger/transition, " +
      "poll cadence, and cumulative run metrics.",
  }),

  // ── lifecycle commands ──
  start: Resource.effectFn(Schema.Void).annotate({
    description: "Begin supervising — fork the trigger driver (idempotent).",
  }),
  stop: Resource.effectFn(Schema.Void).annotate({
    description: "Stop supervising — interrupt the driver and any active run instances.",
    destructive: true,
  }),
  runImmediately: Resource.effectFn(Schema.Void).annotate({
    description:
      "Run the process effect once with tracking, out of band — independent of the trigger cadence.",
  }),

  // ── observability — live stream + history query, paired by nesting ──
  logs: {
    live: Resource.stream(processLogEntry).annotate({
      description:
        "Captured log lines (engine + instance effect) with level/annotations/spans — empty unless " +
        "the process was configured to capture logs.",
    }),
    history: Resource.effect(Schema.Array(processLogEntry), {
      payload: historyQuery,
    }).annotate({
      description:
        "Past captured log lines from the HistoryStore (newest `limit` within `since`/`until`); " +
        "empty unless captureLogs + a HistoryStore layer are provided.",
    }),
  },
};
// Note: no `satisfies Spec` — it contextually widens each method's error channel to `unknown`.
// The spec is validated (without widening) at the `Resource.Tag` call site.

/** The base (schedule-less, result-less) process spec. @public */
export type ProcessSpec = typeof processSpec;

// ============================================================================
// Tag options + schema stamps
// ============================================================================

/**
 * Options for {@link Tag} — use as the sole 2nd argument (config-object overload) or merge with
 * positional `success` / `error` args.
 *
 * @public
 */
export type ProcessTagOptions = {
  readonly description?: string;
  readonly success?: Schema.Top;
  readonly error?: Schema.Top;
  readonly node?: NodeKey<unknown>;
};

/** Read the success schema stamped on a process tag, if any. @public */
export { successOf, errorOf };

// ============================================================================
// The `schedule` verb group (grafted onto a process that owns an inline schedule)
// ============================================================================

/**
 * The schedule mutation verbs a process gains when it {@link schedule | owns an inline schedule}.
 * Reading is `entries` (reactive); mutation is `set` / `add` / `clear`. This is how you arm/disarm:
 * `armed` is derived from the entries, so arming is done by mutating them.
 *
 * @public
 */
export const scheduleGroupSpec = {
  entries: Resource.ref(Schema.Array(processScheduleEntry)).annotate({
    description: "The process's current schedule entries (run windows), reactive.",
  }),
  set: Resource.effectFn(Schema.Void, {
    payload: Schema.Array(processScheduleEntry),
  }).annotate({
    description: "Replace all schedule entries.",
  }),
  add: Resource.effectFn(Schema.Void, { payload: processScheduleEntry }).annotate({
    description: "Append one schedule entry.",
  }),
  clear: Resource.effectFn(Schema.Void).annotate({
    description: "Remove all schedule entries (disarms until new entries are added).",
    destructive: true,
  }),
};
// Note: no `satisfies Spec` — it contextually widens each method's error channel to `unknown`.
// The graft is validated (without widening) when `schedule` rebuilds the tag's RPC group.

/** The `schedule` group as a nested {@link Spec} fragment (what {@link schedule}'s inline form grafts). */
type ScheduleGroupSpec = { readonly schedule: typeof scheduleGroupSpec };

// ============================================================================
// The standalone `Schedule` resource spec (a reusable, RPC-capable window manager)
// ============================================================================

/**
 * The full CRUD contract of a standalone {@link Schedule} resource — the reusable window manager
 * one or more processes can be gated by. Mirrors the engine's {@link ProcessScheduleService}.
 *
 * @public
 */
export const scheduleResourceSpec = {
  entries: Resource.ref(Schema.Array(processScheduleEntry)).annotate({
    description: "All schedule entries (run windows), reactive.",
  }),
  get: Resource.effect(Schema.Option(processScheduleEntry), {
    payload: { id: Schema.String },
  }).annotate({
    description: "Look up a single entry by id (absent if none matches).",
  }),
  has: Resource.effect(Schema.Boolean, { payload: { id: Schema.String } }).annotate({
    description: "Whether an entry with the given id exists.",
  }),
  set: Resource.effectFn(Schema.Void, {
    payload: Schema.Array(processScheduleEntry),
  }).annotate({
    description: "Replace all schedule entries.",
  }),
  add: Resource.effectFn(Schema.Void, { payload: processScheduleEntry }).annotate({
    description: "Append one schedule entry.",
  }),
  upsert: Resource.effectFn(Schema.Void, { payload: processScheduleEntry }).annotate({
    description: "Insert or replace an entry, keyed by its id.",
  }),
  remove: Resource.effectFn(Schema.Boolean, { payload: { id: Schema.String } }).annotate({
    description: "Remove the entry with the given id; returns whether one was removed.",
    destructive: true,
  }),
  removeMany: Resource.effectFn(Schema.Number, {
    payload: Schema.Array(Schema.String),
  }).annotate({
    description: "Remove every entry whose id is listed; returns the count removed.",
    destructive: true,
  }),
  clear: Resource.effectFn(Schema.Void).annotate({
    description: "Remove all schedule entries.",
    destructive: true,
  }),
};
// Note: no `satisfies Spec` — it contextually widens each method's error channel to `unknown`.
// The spec is validated (without widening) at the `Resource.Tag` call site.

/** The standalone {@link Schedule} resource's spec. @public */
export type ScheduleResourceSpec = typeof scheduleResourceSpec;

// ============================================================================
// The `result` field (grafted onto a value-returning process)
// ============================================================================

/** The reactive `result` field a value-returning process gains via {@link result}. */
type ResultField<A extends Schema.Top> = RefField<
  Method<"query", undefined, Schema.Option<A>, typeof Schema.Never, true>
>;

/** The `result` field as a {@link Spec} fragment (what {@link result} grafts). */
type ResultGroupSpec<A extends Schema.Top> = { readonly result: ResultField<A> };

// ============================================================================
// Schedule windows (entry templates) — id optional
// ============================================================================

/**
 * A schedule **window** template produced by {@link at} / {@link window} — the declarative form of
 * a schedule entry. `id` is **optional** (a nameless window is `add`/`set`/`clear`'d and matched by
 * reference, but is invisible to id-keyed ops). The runtime maps these to the engine's native
 * {@link ProcessScheduleEntry}.
 *
 * @public
 */
export interface ScheduleWindow {
  readonly id: Option.Option<string>;
  readonly startAt: Date;
  readonly stopAt: Option.Option<Date>;
}

const toWindowId = (id: string | undefined): Option.Option<string> =>
  id === undefined ? Option.none() : Option.some(id);

/**
 * A **point** window (open-ended — no stop). The leading `id` is optional.
 *
 * ```ts
 * Process.at(startDate)            // nameless
 * Process.at("daily-2am", startDate)
 * ```
 *
 * @public
 */
export function at(startAt: Date): ScheduleWindow;
export function at(id: string, startAt: Date): ScheduleWindow;
export function at(idOrStartAt: string | Date, maybeStartAt?: Date): ScheduleWindow {
  if (idOrStartAt instanceof Date) {
    return { id: Option.none(), startAt: idOrStartAt, stopAt: Option.none() };
  }
  if (maybeStartAt === undefined) {
    throw new Error("Process.at(id, startAt): startAt is required");
  }
  return { id: toWindowId(idOrStartAt), startAt: maybeStartAt, stopAt: Option.none() };
}

/**
 * A **bounded** window (`start` + `stop`). The leading `id` is optional.
 *
 * ```ts
 * Process.window(gameStart, gameEnd)            // nameless
 * Process.window("game-123", gameStart, gameEnd)
 * ```
 *
 * @public
 */
export function window(startAt: Date, stopAt: Date): ScheduleWindow;
export function window(id: string, startAt: Date, stopAt: Date): ScheduleWindow;
export function window(
  idOrStartAt: string | Date,
  startAtOrStopAt: Date,
  maybeStopAt?: Date,
): ScheduleWindow {
  if (idOrStartAt instanceof Date) {
    return {
      id: Option.none(),
      startAt: idOrStartAt,
      stopAt: Option.some(startAtOrStopAt),
    };
  }
  if (maybeStopAt === undefined) {
    throw new Error("Process.window(id, startAt, stopAt): stopAt is required");
  }
  return {
    id: toWindowId(idOrStartAt),
    startAt: startAtOrStopAt,
    stopAt: Option.some(maybeStopAt),
  };
}

// ============================================================================
// Engine schedule constructors — the public face of the internal schedule primitive
// ============================================================================

/**
 * A native engine schedule **entry** — `{ id?, startAt, stopAt? }`, the same shape as a
 * {@link ScheduleWindow} ({@link at} / {@link window} build these). Element of a
 * {@link ScheduleService}'s entries.
 *
 * @public
 */
export type ScheduleEntry = ProcessScheduleEntry;

/**
 * The engine schedule **service** — run-window storage + controls (`entries` / `changed` / CRUD /
 * `reconcile`) that a {@link make} supervisor watches for arming decisions. Materialized by the
 * schedule-layer constructors below and injected via {@link ProcessMakeOptions.scheduleLayer}.
 *
 * @public
 */
export type ScheduleService = ProcessScheduleService;

/**
 * The subset of schedule controls handed to a {@link ProcessScheduleInitializer}
 * (`entries` / `set` / `add` / `clear`) and available inside the process effect via
 * {@link scheduleControls}.
 *
 * @public
 */
export type ScheduleControls = ProcessScheduleControls;

/**
 * The diff produced by {@link ScheduleService.reconcile} — the entry ids that were
 * added / updated / removed / left unchanged.
 *
 * @public
 */
export type ScheduleReconcileResult = ReconcileResult;

// These re-expose the internal engine schedule constructors for `make`'s `scheduleLayer`. They are
// deliberately **lazy wrappers** (not `= ProcessSchedule.x`): a direct re-export would reference the
// engine at module load, defeating tree-shaking so a `Process.Tag`-only import would drag the engine
// schedule primitive into the bundle. Wrapping keeps the reference inside an eliminable function body.

/**
 * An **in-memory** schedule layer seeded with `entries` — the `Layer` you hand to {@link make}'s
 * `scheduleLayer`. Call with no argument for an **empty** schedule (disarmed until an entry is added
 * via `set` / `add` / `reconcile` or a schedule initializer). Mutable at runtime through the schedule
 * controls (`Process.scheduleControls`, the inline `schedule` verbs, or a {@link Schedule} resource).
 *
 * @public
 */
export const scheduleInMemory = (
  entries?: ReadonlyArray<ScheduleEntry>,
): ProcessScheduleLayerInput => ProcessSchedule.inMemory(entries);

/**
 * A **declarative** schedule layer from a builder DSL:
 * `Process.scheduleDefine(({ at, window }) => [at("daily", d), window("game", start, end)])`.
 *
 * @public
 */
export const scheduleDefine = (
  build: (api: ScheduleDefineApi) => ReadonlyArray<ScheduleEntry>,
): ProcessScheduleLayerInput => ProcessSchedule.define(build);

// ============================================================================
// Combinator plumbing: augment a tag's spec (rebuild the flat spec + RPC group)
// ============================================================================

/** Where a process tag's schedule mode (inline windows vs external reference) is stowed. @internal */
const scheduleModeSym: unique symbol = Symbol.for(
  "@nikscripts/effect-pm/Process/scheduleMode",
);

/** @internal */
const isProcessTagOptions = (value: unknown): value is ProcessTagOptions =>
  typeof value === "object" &&
  value !== null &&
  !Schema.isSchema(value) &&
  ("description" in value ||
    "node" in value ||
    "success" in value ||
    "error" in value);

/** Graft `result` ref + stamp wire schemas on a process tag. @internal */
const applyProcessTagSchemas = (
  tag: ResourceTag<any, any>,
  schemas: {
    readonly success?: Schema.Top;
    readonly error?: Schema.Top;
  },
): ResourceTag<any, any> => {
  let next = tag;
  const stamp: Partial<Record<typeof successSym | typeof errorSym, Schema.Top>> =
    {};
  if (schemas.success !== undefined) {
    next = augmentTag(
      next,
      {
        result: Resource.ref(Schema.Option(schemas.success)).annotate({
          description:
            "The latest value the process effect resolved to (absent until the first run completes).",
        }),
      },
      {},
    );
    stamp[successSym] = schemas.success;
  }
  if (schemas.error !== undefined) {
    stamp[errorSym] = schemas.error;
  }
  const hasStamp =
    schemas.success !== undefined || schemas.error !== undefined;
  return hasStamp ? Object.assign(next, stamp) : next;
};

/** @internal */
const withProcessReadiness = (
  tag: ResourceTag<any, ProcessSpec>,
): ResourceTag<any, ProcessSpec> =>
  Resource.withReadiness(tag, (svc: ImplOf<ProcessSpec>) =>
    Effect.map(svc.status.get, (s) => ({
      ready: s.supervising,
      ...(s.supervising ? {} : { detail: "not supervising" }),
    })),
  );

/** @internal */
const buildProcessTag = <Self>(
  key: string,
  options: ProcessTagOptions | undefined,
  positional: {
    readonly success?: Schema.Top;
    readonly error?: Schema.Top;
  } = {},
): ResourceTag<any, any> | NodeBoundTag<any, any, unknown> => {
  const node = options?.node;
  const tagOptions = { description: options?.description, kind };
  const base: ResourceTag<any, any> =
    node === undefined
      ? Resource.Tag<Self>()(key, processSpec, tagOptions)
      : Resource.Tag<Self>()(key, processSpec, { ...tagOptions, node });
  const success = positional.success ?? options?.success;
  const error = positional.error ?? options?.error;
  const stamped: ResourceTag<any, any> =
    success === undefined && error === undefined
      ? base
      : applyProcessTagSchemas(base, { success, error });
  return withProcessReadiness(stamped);
};

/** How a process is scheduled — read by the runtime to build the right impl. @internal */
type ScheduleMode =
  | { readonly _tag: "inline"; readonly windows: ReadonlyArray<ScheduleWindow> }
  | { readonly _tag: "reference"; readonly source: ResourceTag<unknown, ScheduleResourceSpec> };

/** Read a process tag's {@link ScheduleMode}, if any (set by {@link schedule}). @internal */
const scheduleModeOf = (tag: unknown): ScheduleMode | undefined => {
  if ((typeof tag === "object" || typeof tag === "function") && tag !== null && scheduleModeSym in tag) {
    const value = (tag as { readonly [scheduleModeSym]?: unknown })[scheduleModeSym];
    return value as ScheduleMode | undefined;
  }
  return undefined;
};

/**
 * Graft path-keyed leaves onto a tag's flat spec and rebuild its RPC group in place, optionally
 * stamping combinator metadata. Reuses the tag's already-claimed `groupId` (no re-claim). Returns
 * the same (mutated) tag — so `class X extends Tag(...).pipe(combinator) {}` extends it. @internal
 */
const augmentTag = (
  tag: ResourceTag<any, any>,
  flatAddition: FlatSpec,
  stamp: object,
): ResourceTag<any, any> => {
  const nextFlat: FlatSpec = { ...tag[specSym], ...flatAddition };
  return Object.assign(
    tag,
    { [specSym]: nextFlat, [groupSym]: buildRpcGroup(tag.groupId, nextFlat) },
    stamp,
  );
};

/** Flatten the one-level `schedule` group to path keys (`schedule.entries`, …). @internal */
const scheduleGroupFlat: FlatSpec = Object.fromEntries(
  Object.entries(scheduleGroupSpec).map(([k, v]) => [`schedule.${k}`, v]),
);

// ============================================================================
// Combinators
// ============================================================================

/**
 * Attach a schedule to a process (pipeable). Two forms, distinguished by argument:
 *
 * - **inline windows** — the process **owns** an in-memory schedule seeded with `windows`, and its
 *   contract gains the `schedule` verb group (`entries` / `set` / `add` / `clear`):
 *
 * ```ts
 * class Matches extends Process.Tag<Matches>()("app/Matches").pipe(
 *   Process.schedule([Process.window(kickoff, final)]),
 * ) {}
 * ```
 *
 * - **an external {@link Schedule}** — the process is **gated by** a shared schedule resource and
 *   gains **no** schedule verbs (they live on the resource, which can arm many processes at once):
 *
 * ```ts
 * class IngestScores extends Process.Tag<IngestScores>()("app/IngestScores").pipe(
 *   Process.schedule(SeasonSchedule),
 * ) {}
 * ```
 *
 * @public
 */
export function schedule(
  windows: ReadonlyArray<ScheduleWindow>,
): <Self, S extends Spec>(tag: ResourceTag<Self, S>) => ResourceTag<any, S & ScheduleGroupSpec>;
export function schedule(
  source: ResourceTag<any, ScheduleResourceSpec>,
): <Self, S extends Spec>(tag: ResourceTag<Self, S>) => ResourceTag<any, S>;
export function schedule(
  windowsOrSource: ReadonlyArray<ScheduleWindow> | ResourceTag<any, any>,
): (tag: ResourceTag<any, any>) => ResourceTag<any, any> {
  // A type-guard (not bare `Array.isArray`) so the else-branch narrows to the tag: `Array.isArray`
  // alone won't remove a `ReadonlyArray` from the union.
  const isWindows = (
    x: ReadonlyArray<ScheduleWindow> | ResourceTag<any, any>,
  ): x is ReadonlyArray<ScheduleWindow> => Array.isArray(x);
  if (isWindows(windowsOrSource)) {
    const mode: ScheduleMode = { _tag: "inline", windows: windowsOrSource };
    return (tag) => augmentTag(tag, scheduleGroupFlat, { [scheduleModeSym]: mode });
  }
  const mode: ScheduleMode = { _tag: "reference", source: windowsOrSource };
  // reference form: shape is unchanged — just stamp the mode (identity, like `distributed`).
  return (tag) => Object.assign(tag, { [scheduleModeSym]: mode });
}

// ============================================================================
// Tag factories
// ============================================================================

/** Callable shape for {@link Tag} — overloads for positional schemas + config object. @public */
export type ProcessTagBuild<Self> = {
  (key: string): ResourceTag<Self, ProcessSpec>;
  <A extends Schema.Top>(
    key: string,
    success: A,
  ): ResourceTag<Self, ProcessSpec & ResultGroupSpec<A>>;
  <A extends Schema.Top, E extends Schema.Top>(
    key: string,
    success: A,
    error: E,
  ): ResourceTag<Self, ProcessSpec & ResultGroupSpec<A>>;
  <HSelf>(
    key: string,
    options: ProcessTagOptions & { readonly node: NodeKey<HSelf> },
  ): NodeBoundTag<Self, ProcessSpec, HSelf>;
  (key: string, options: ProcessTagOptions): ResourceTag<Self, ProcessSpec>;
};

/**
 * Define a managed process as a toolkit resource. `Self` is given explicitly (Effect's `()`
 * two-stage form). The base tag carries observation + lifecycle; add a schedule with
 * `.pipe(`{@link schedule}`(…))`. Declare value/error wire schemas on the tag:
 *
 * ```ts
 * class Health extends Process.Tag<Health>()("app/Health") {}
 *
 * class Prices extends Process.Tag<Prices>()("app/Prices", PriceSchema) {}
 *
 * class PricesE extends Process.Tag<PricesE>()("app/Prices", PriceSchema, FetchErr) {}
 *
 * class PricesCfg extends Process.Tag<PricesCfg>()("app/Prices", {
 *   success: PriceSchema,
 *   error: FetchErr,
 * }) {}
 * ```
 *
 * Pass `options.node` to bind the process to a {@link Resource.Node}.
 *
 * @public
 */
export const Tag = <Self>() => {
  function build(
    key: string,
    second?: Schema.Top | ProcessTagOptions,
    third?: Schema.Top,
  ): ResourceTag<Self, ProcessSpec> | NodeBoundTag<Self, ProcessSpec, unknown> {
    if (second === undefined) {
      return buildProcessTag<Self>(key, undefined);
    }
    if (Schema.isSchema(second)) {
      return buildProcessTag<Self>(key, undefined, {
        success: second,
        error: third,
      });
    }
    if (isProcessTagOptions(second)) {
      return buildProcessTag<Self>(key, second);
    }
    return buildProcessTag<Self>(key, undefined);
  }
  return build as ProcessTagBuild<Self>;
};

/**
 * Define a standalone {@link Schedule} resource — a reusable, RPC-capable window manager one or more
 * processes can be gated by (via `.pipe(`{@link schedule}`(ThisSchedule))`). Full CRUD; pass
 * `options.node` to bind it to a {@link Resource.Node}, like {@link Tag}.
 *
 * ```ts
 * class SeasonSchedule extends Process.Schedule<SeasonSchedule>()("app/SeasonSchedule") {}
 * const s = yield* SeasonSchedule;
 * yield* s.add({ id: "wk2", startAt: wk2Start, stopAt: wk2End }); // arms every gated process
 * ```
 *
 * @public
 */
export const Schedule = <Self>() => {
  function build<HSelf>(
    key: string,
    options: { readonly description?: string; readonly node: NodeKey<HSelf> },
  ): NodeBoundTag<Self, ScheduleResourceSpec, HSelf>;
  function build(
    key: string,
    options?: { readonly description?: string },
  ): ResourceTag<Self, ScheduleResourceSpec>;
  function build(
    key: string,
    options?: { readonly description?: string; readonly node?: NodeKey<unknown> },
  ): ResourceTag<Self, ScheduleResourceSpec> {
    const node = options?.node;
    const tagOptions = { description: options?.description, kind: scheduleKind };
    return node === undefined
      ? Resource.Tag<Self>()(key, scheduleResourceSpec, tagOptions)
      : Resource.Tag<Self>()(key, scheduleResourceSpec, { ...tagOptions, node });
  }
  return build;
};

// ============================================================================
// Toolkit runtime — config
// ============================================================================

/**
 * Config for {@link layer} / {@link serve} / {@link serveRemote}. The `effect` is the work each run
 * performs; its success is captured into `result` when the tag is value-returning. Scheduling comes
 * from the **tag** now (`Process.schedule(...)`), not the config.
 *
 * @public
 */
export interface ProcessLayerConfig<A, E, R> {
  readonly effect: Effect.Effect<A, E, R>;
  /** Optional polling layer for in-instance repeat cadence. */
  readonly polling?: Layer.Layer<PollingTag, never, never>;
  /**
   * Capture this process's logs (engine + instance effect) into the `logs.live` stream — and, with
   * a `HistoryStore` layer, into `logs.history`. `true` = all levels; `{ level }` = at or above it.
   */
  readonly captureLogs?: boolean | { readonly level?: LogLevel.LogLevel };
}

// ============================================================================
// wire ⇄ engine mapping
// ============================================================================

type WireEntry = typeof processScheduleEntry.Type;

const toWireEntry = (entry: ProcessScheduleEntry): WireEntry => ({
  ...(Option.isSome(entry.id) ? { id: entry.id.value } : {}),
  startAt: DateTime.makeUnsafe(entry.startAt.getTime()),
  ...(Option.isSome(entry.stopAt)
    ? { stopAt: DateTime.makeUnsafe(entry.stopAt.value.getTime()) }
    : {}),
});

const fromWireEntry = (wire: WireEntry): ProcessScheduleEntry => ({
  id: wire.id !== undefined ? Option.some(wire.id) : Option.none(),
  startAt: DateTime.toDateUtc(wire.startAt),
  stopAt:
    wire.stopAt !== undefined
      ? Option.some(DateTime.toDateUtc(wire.stopAt))
      : Option.none(),
});

const toWireStatus = (
  snap: ProcessSnapshot,
  supervising: boolean,
): typeof processStatus.Type => ({
  supervising,
  armed: snap.armed,
  activeInstances: snap.activeInstances,
  ...(Option.isSome(snap.nextTriggerRun)
    ? { nextTriggerRun: DateTime.makeUnsafe(snap.nextTriggerRun.value.getTime()) }
    : {}),
  ...(Option.isSome(snap.nextScheduleTransition)
    ? {
        nextScheduleTransition: DateTime.makeUnsafe(
          snap.nextScheduleTransition.value.getTime(),
        ),
      }
    : {}),
  ...(Option.isSome(snap.nextPollCadence)
    ? { nextPollCadence: snap.nextPollCadence.value }
    : {}),
  runsStarted: snap.runsStarted,
  runsSucceeded: snap.runsSucceeded,
  runsFailed: snap.runsFailed,
  ...(Option.isSome(snap.lastRunStartedAt)
    ? { lastRunStartedAt: DateTime.makeUnsafe(snap.lastRunStartedAt.value.getTime()) }
    : {}),
  ...(Option.isSome(snap.lastRunDurationMillis)
    ? { lastRunDurationMillis: snap.lastRunDurationMillis.value }
    : {}),
});

/** A reactive view of a schedule's entries (wire form), driven by its `changed` signal. */
const entriesSubscribable = (
  svc: ProcessScheduleService,
): Subscribable<ReadonlyArray<WireEntry>> => ({
  get: Effect.map(svc.entries, (entries) => entries.map(toWireEntry)),
  changes: Stream.concat(
    Stream.fromEffect(svc.entries),
    Stream.fromEffectRepeat(Effect.flatMap(svc.changed, () => svc.entries)),
  ).pipe(Stream.map((entries) => entries.map(toWireEntry))),
});

/** Thrown (as a defect) when a reference-mode process is materialized before its runtime lands. */
class ReferenceScheduleNotWired extends Data.TaggedError(
  "ReferenceScheduleNotWired",
)<{ readonly process: string }> {}

// ============================================================================
// Per-process log capture
// ============================================================================

const makeProcessCaptureLogger = (
  processId: string,
  minLevel: LogLevel.LogLevel,
  publish: (entry: LogEntry) => Effect.Effect<void>,
): Logger.Logger<unknown, void> =>
  Logger.make((options) => {
    if (!LogLevel.isGreaterThanOrEqualTo(options.logLevel, minLevel)) return;
    const annotations = options.fiber.getRef(CurrentLogAnnotations);
    if (annotations[LogAnnotationKeys.processId] !== processId) {
      return;
    }
    const entry = logEntryFromLoggerOptions({
      message: options.message,
      logLevel: options.logLevel,
      cause: options.cause,
      date: options.date,
      annotations,
      spans: options.fiber.getRef(CurrentLogSpans),
    });
    options.fiber.currentDispatcher.scheduleTask(() => {
      Effect.runFork(publish(entry));
    }, 0);
  });

const statusPollInterval = Duration.millis(500);

/** The decoded `logs.history` payload — mirrors {@link HistoryStore}'s read options. */
interface HistoryQuery {
  readonly limit?: number;
  readonly since?: DateTime.Utc;
  readonly until?: DateTime.Utc;
}

const fromWindow = (w: ScheduleWindow): ProcessScheduleEntry => ({
  id: w.id,
  startAt: w.startAt,
  stopAt: w.stopAt,
});

// ============================================================================
// Process impl builder
// ============================================================================

/**
 * Build the live process driver behind `tag` and map it onto the toolkit service impl — the adapter
 * shared by {@link layer} / {@link serve} / {@link serveRemote}. The returned record is shaped to the
 * tag's composed spec (base, `+ schedule`, `+ result`); `Resource.layer` flattens it against the
 * tag's flat spec, so extra members are simply present when the spec declares them.
 */
const buildProcessImpl = <A, E, R>(
  tag: ResourceTag<any, any>,
  baseConfig: ProcessLayerConfig<A, E, R>,
): Effect.Effect<ImplOf<ProcessSpec>, never, R | Scope.Scope | StoreScopeBridgeTag> =>
  Effect.gen(function* () {
    const context = yield* Effect.context<R>();
    const scope = yield* Effect.scope;
    const provideR = <Out, Err>(effect: Effect.Effect<Out, Err, R>): Effect.Effect<Out, Err> =>
      Effect.provide(effect, context);

    const config = yield* foldConfiguredSpec<ProcessLayerConfig<A, E, R>>(tag.key, baseConfig);

    const mode = scheduleModeOf(tag);
    if (mode?._tag === "reference") {
      return yield* Effect.die(new ReferenceScheduleNotWired({ process: tag.key }));
    }

    // ── result capture (value-returning process) ──
    const successSchema = successOf(tag);
    const resultRef =
      successSchema !== undefined
        ? yield* SubscriptionRef.make<Option.Option<unknown>>(Option.none())
        : undefined;
    const captured: Effect.Effect<void, E, R> =
      resultRef !== undefined
        ? config.effect.pipe(
            Effect.tap((value) => SubscriptionRef.set(resultRef, Option.some(value))),
            Effect.asVoid,
          )
        : Effect.asVoid(config.effect);

    // ── per-process log capture (optional) ──
    const captureLogsConfig = config.captureLogs;
    const captureLogsEnabled =
      captureLogsConfig === true ||
      (typeof captureLogsConfig === "object" && captureLogsConfig !== null);
    const captureLogsMinLevel: LogLevel.LogLevel =
      typeof captureLogsConfig === "object" && captureLogsConfig !== null
        ? (captureLogsConfig.level ?? "All")
        : "All";
    const logsHub = yield* PubSub.sliding<LogEntry>(1024);
    const logReplayCapacity = 256;
    const logReplay = yield* Ref.make<ReadonlyArray<LogEntry>>([]);
    const publishLog = (entry: LogEntry): Effect.Effect<void> =>
      Effect.andThen(PubSub.publish(logsHub, entry), () =>
        Ref.update(logReplay, (tail) => {
          const next = [...tail, entry];
          return next.length <= logReplayCapacity
            ? next
            : next.slice(next.length - logReplayCapacity);
        }),
      );
    const loggerContext = captureLogsEnabled
      ? yield* Layer.build(
          Logger.layer([makeProcessCaptureLogger(tag.key, captureLogsMinLevel, publishLog)], {
            mergeWithExisting: true,
          }),
        )
      : undefined;
    const tapLogs =
      loggerContext === undefined
        ? <A2, E2, R2>(effect: Effect.Effect<A2, E2, R2>): Effect.Effect<A2, E2, R2> => effect
        : <A2, E2, R2>(effect: Effect.Effect<A2, E2, R2>): Effect.Effect<A2, E2, R2> =>
            withProcessLogAnnotations(tag.key, Effect.provide(effect, loggerContext));
    const logsStream = captureLogsEnabled
      ? Stream.unwrap(
          Effect.map(Ref.get(logReplay), (tail) =>
            Stream.concat(Stream.fromIterable(tail), Stream.fromPubSub(logsHub)),
          ),
        )
      : Stream.empty;

    const history = yield* Effect.serviceOption(HistoryStore);
    const logsStreamId = `${tag.key}/logs`;
    if (captureLogsEnabled && Option.isSome(history)) {
      const store = history.value;
      yield* Effect.forkIn(
        Stream.runForEach(Stream.fromPubSub(logsHub), (line) =>
          Schema.encodeEffect(processLogEntry)(line).pipe(
            Effect.flatMap((encoded) => store.append(logsStreamId, encoded)),
            Effect.orDie,
          ),
        ),
        scope,
      );
    }

    // ── schedule: inline windows own an in-memory store; otherwise always-armed ──
    const baseScheduleLayer =
      mode?._tag === "inline"
        ? ProcessSchedule.inMemory(mode.windows.map(fromWindow))
        : ProcessSchedule.alwaysArmed;
    const scheduleCtx = yield* Layer.build(baseScheduleLayer);
    const scheduleSvc = Context.get(scheduleCtx, ProcessScheduleTag);

    const executionRecorder = yield* makeProcessExecutionRecorder({
      scopeKey: tag.key,
      tag,
      resultRef,
    });

    const handle = make(tag.key, {
      effect: captured,
      ...(config.polling !== undefined ? { polling: config.polling } : {}),
      scheduleLayer: Layer.succeedContext(scheduleCtx),
      _executionRecorder: executionRecorder,
    });

    const fiberRef = yield* Ref.make<Fiber.Fiber<void, never> | null>(null);
    const start = Effect.gen(function* () {
      if ((yield* Ref.get(fiberRef)) !== null) return;
      const fiber = yield* Effect.forkIn(handle.effect.pipe(tapLogs, provideR), scope);
      yield* Ref.set(fiberRef, fiber);
    });
    const stop = Effect.gen(function* () {
      const fiber = yield* Ref.get(fiberRef);
      if (fiber === null) return;
      yield* Fiber.interrupt(fiber);
      yield* Ref.set(fiberRef, null);
    });
    const readStatus = Effect.gen(function* () {
      const supervising = (yield* Ref.get(fiberRef)) !== null;
      return toWireStatus(yield* handle.snapshot, supervising);
    });

    yield* start; // auto-start the driver on build

    // `status` is a reactive `ref`: `get` reads the snapshot on demand; `changes` polls it (the
    // engine mirror is a set of MutableRefs with no native subscription), one SSOT for both.
    const statusChanges = Stream.tick(statusPollInterval).pipe(
      Stream.mapEffect(() => readStatus),
    );
    const base: ImplOf<ProcessSpec> = {
      status: { get: readStatus, changes: statusChanges },
      start,
      stop,
      runImmediately: handle.runImmediately().pipe(tapLogs, provideR),
      logs: {
        live: logsStream,
        history: ({ limit, since, until }: HistoryQuery) =>
          Option.match(history, {
            onNone: () => Effect.succeed<ReadonlyArray<typeof processLogEntry.Type>>([]),
            onSome: (store) =>
              store.read(logsStreamId, { limit, since, until }).pipe(
                Effect.flatMap((rows) =>
                  Effect.forEach(rows, (row) =>
                    Schema.decodeUnknownEffect(processLogEntry)(row).pipe(Effect.orDie),
                  ),
                ),
              ),
          }),
      },
    };

    // Grafted members: present only when the tag composes them in, and served by their path key via
    // the tag's full flat spec (`schedule.*` / `result`). They widen the runtime record beyond the
    // base `ImplOf`, so they're spread on (not declared) — the base annotation is what `Resource`'s
    // layer/serve type against, while the runtime object carries whatever the composed spec declares.
    const scheduleMembers =
      mode?._tag === "inline"
        ? {
            schedule: {
              entries: entriesSubscribable(scheduleSvc),
              set: (entries: ReadonlyArray<WireEntry>) =>
                scheduleSvc.set(entries.map(fromWireEntry)),
              add: (entry: WireEntry) => scheduleSvc.add(fromWireEntry(entry)),
              clear: scheduleSvc.clear,
            },
          }
        : {};
    const resultMembers =
      resultRef !== undefined ? { result: Resource.subscribable(resultRef) } : {};

    return { ...base, ...scheduleMembers, ...resultMembers };
  });

// ============================================================================
// Public layers
// ============================================================================

// The public layers are **overloaded**: the visible signature is generic over the tag's composed spec
// `S` (so a `+ schedule` / `+ result` tag is accepted and `Self` — the composed service — is granted),
// while the implementation signature is loose (`ResourceTag<any, any>` + a loose impl) so the
// dynamically-shaped `buildProcessImpl` record fits. Two deliberate choices keep the types shallow:
//   1. the visible **return** names `HandlerContextOf<ProcessSpec>` (the concrete base), not
//      `HandlerContextOf<S>` — walking that over an open `S` blows the instantiation depth, and the
//      served handler set is a run-time concern anyway (see 2);
//   2. internally the tag is narrowed to the concrete base spec (`baseTag`) before `Resource.serve`,
//      so its `HandlerContextOf`/`ImplOf` walks stay shallow.
// At run time `Resource.serve` reads the tag's own `groupSym` / `specSym`, so the **full** handler set
// (incl. the grafted `schedule` / `result` verbs) is mounted even though the static `HandlerContextOf`
// names the base. `buildProcessImpl` receives the original tag, so it still reads the composed metadata.

/**
 * The **local** layer for a process: build its driver (auto-started) and provide its service.
 *
 * @public
 */
export function layer<Self, S extends Spec, A = void, E = never, R = never>(
  tag: ResourceTag<Self, S>,
  config: ProcessLayerConfig<A, E, R>,
): Layer.Layer<Self | Local<Self>, never, R | StoreScopeBridgeTag>;
export function layer(
  tag: ResourceTag<any, any>,
  config: ProcessLayerConfig<any, any, any>,
): Layer.Layer<any, any, any> {
  const baseTag: ResourceTag<any, ProcessSpec> = tag;
  return Layer.unwrap(
    Effect.map(buildProcessImpl(tag, config), (impl) => Resource.layer(baseTag, impl)),
  );
}

/**
 * Serve a process **and** grant its local instance from one materialization.
 *
 * @public
 */
export function serve<Self, S extends Spec, A = void, E = never, R = never>(
  tag: ResourceTag<Self, S>,
  config: ProcessLayerConfig<A, E, R>,
): Layer.Layer<Self | Local<Self> | HandlerContextOf<ProcessSpec>, never, R | StoreScopeBridgeTag>;
export function serve(
  tag: ResourceTag<any, any>,
  config: ProcessLayerConfig<any, any, any>,
): Layer.Layer<any, any, any> {
  const baseTag: ResourceTag<any, ProcessSpec> = tag;
  return Layer.unwrap(
    Effect.map(
      buildProcessImpl(tag, config),
      (impl): Layer.Layer<any, any, any> => Resource.serve(baseTag, impl),
    ),
  );
}

/**
 * Serve a process **remotely (served-only)** — mounts its RPC handlers without granting the local
 * instance, preserving the requirement `R` for a per-resource `Layer.provide`.
 *
 * @public
 */
export function serveRemote<Self, S extends Spec, A = void, E = never, R = never>(
  tag: ResourceTag<Self, S>,
  config: ProcessLayerConfig<A, E, R>,
): Layer.Layer<HandlerContextOf<ProcessSpec>, never, R | StoreScopeBridgeTag>;
export function serveRemote(
  tag: ResourceTag<any, any>,
  config: ProcessLayerConfig<any, any, any>,
): Layer.Layer<any, any, any> {
  const baseTag: ResourceTag<any, ProcessSpec> = tag;
  return Layer.unwrap(
    Effect.map(
      buildProcessImpl(tag, config),
      (impl): Layer.Layer<any, any, any> => Resource.serveRemote(baseTag, impl),
    ),
  );
}

/**
 * A **config-patch layer** for the process `tag` — merge it with the process's {@link layer} and its
 * patch (polling / a `(previous) => next` wrap of `effect`) folds onto the base config at build.
 *
 * @public
 */
export const configure = <A = void, E = never, R = never>(
  tag: ResourceTag<any, any>,
  patch: ConfigPatch<ProcessLayerConfig<A, E, R>>,
): Layer.Layer<never> => configureLayer(tag.key, patch);

/**
 * Register this process on an app {@link Store.Service} — built-in execution analytics with an
 * optional bare spec object merged in:
 *
 * ```ts
 * Process.store(Daily)
 * Process.store(Daily, {
 *   audit: auditSchema,
 * }, ({ audit, event }) => ({
 *   appendAudit: audit.append,
 * }))
 * ```
 *
 * @public
 */
export function store<const Tag extends StoreScopeTag>(tag: Tag): ReturnType<
  typeof facetStoreRegistration<Tag, BuiltInProcessContract>
>;
export function store<
  const Tag extends StoreScopeTag,
  const Shapes extends StoreShapes,
>(tag: Tag, extended: Shapes): ReturnType<
  typeof facetStoreRegistration<
    Tag,
    BuiltInProcessContract,
    Shapes
  >
>;
export function store(tag: StoreScopeTag, extended?: StoreShapes) {
  const builtIn = builtInProcessStoreContract(tag);
  return extended === undefined
    ? facetStoreRegistration(tag, builtIn)
    : facetStoreRegistration(tag, builtIn, extended);
}

// ============================================================================
// Standalone Schedule resource layer
// ============================================================================

const buildScheduleImpl = (
  options?: { readonly initial?: ReadonlyArray<ScheduleWindow> },
): Effect.Effect<ImplOf<ScheduleResourceSpec>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const ctx = yield* Layer.build(
      ProcessSchedule.inMemory((options?.initial ?? []).map(fromWindow)),
    );
    const scheduleSvc = Context.get(ctx, ProcessScheduleTag);
    const impl: ImplOf<ScheduleResourceSpec> = {
      entries: entriesSubscribable(scheduleSvc),
      get: ({ id }: { readonly id: string }) =>
        Effect.map(scheduleSvc.get(id), Option.map(toWireEntry)),
      has: ({ id }: { readonly id: string }) => scheduleSvc.has(id),
      set: (entries: ReadonlyArray<WireEntry>) => scheduleSvc.set(entries.map(fromWireEntry)),
      add: (entry: WireEntry) => scheduleSvc.add(fromWireEntry(entry)),
      upsert: (entry: WireEntry) => scheduleSvc.upsert(fromWireEntry(entry)),
      remove: ({ id }: { readonly id: string }) => scheduleSvc.remove(id),
      removeMany: (ids: ReadonlyArray<string>) => scheduleSvc.removeMany(ids),
      clear: scheduleSvc.clear,
    };
    return impl;
  });

/**
 * The **local** layer for a standalone {@link Schedule} resource — an in-memory window manager
 * (optionally seeded with `initial` windows) that any number of processes can be gated by.
 *
 * @public
 */
export const scheduleLayer = <Self>(
  tag: ResourceTag<Self, ScheduleResourceSpec>,
  options?: { readonly initial?: ReadonlyArray<ScheduleWindow> },
): Layer.Layer<Self | Local<Self>> =>
  Layer.unwrap(
    Effect.map(buildScheduleImpl(options), (impl) => Resource.layer(tag, impl)),
  );

/**
 * Serve a standalone {@link Schedule} resource **and** grant its local instance.
 *
 * @public
 */
export const scheduleServe = <Self>(
  tag: ResourceTag<Self, ScheduleResourceSpec>,
  options?: { readonly initial?: ReadonlyArray<ScheduleWindow> },
): Layer.Layer<Self | Local<Self> | HandlerContextOf<ScheduleResourceSpec>> =>
  Layer.unwrap(
    Effect.map(buildScheduleImpl(options), (impl) => Resource.serve(tag, impl)),
  );

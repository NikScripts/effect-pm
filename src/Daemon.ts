/**
 * **Daemon** — trigger-driven supervised instances.
 *
 * @remarks
 * A started daemon has a long-lived **driver** fiber that follows
 * {@link DaemonSchedule} entries. Each eligible `startAt` spawns a run instance.
 * Inside an instance,
 * we repeatedly:
 * 1. check the active entry `stopAt`
 * 2. if closed: exit the instance naturally
 * 3. otherwise await {@link Polling.Service.awaitNextTick | Polling awaitNextTick}, run the tracked user effect,
 *    then {@link Polling.Service.afterTick | Polling afterTick}.
 *
 * Default overlap policy is **parallel** because the driver forks each instance.
 *
 * ## Execution analytics (toolkit `layer` path)
 *
 * {@link layer}, {@link serve}, and {@link serveRemote} soft-default {@link Store.layerDefaultMemory}
 * via {@link Store.withDefaultStorage} — **R is fulfilled** out of the box. Override by providing
 * your {@link Store.Service} into the toolkit layer so Soft unwrap captures that bridge (memory +
 * Logs, or SQLite):
 *
 * ```ts
 * Daemon.layer(Tag, config).pipe(Layer.provideMerge(AppStore.layer({ filename })))
 * Node.httpServer([Daemon.serve(Tag, config)]).pipe(Layer.provide(AppStore.layerMemory))
 * ```
 *
 * ## Live `events` (persist == stream)
 *
 * Every engine lifecycle write (`Started` / `Completed` / `Failed` / `Interrupted`) is published to a
 * sliding PubSub **and** appended to the store when one is wired — the same union as
 * {@link daemonExecutionEvent} / {@link Daemon.store}. Consume with `yield* proc.events` (Queue-shaped).
 * Fan-out may drop under load; the store remains the durable source of truth. Tick / run-body failures
 * emit `Failed` on the stream; manual {@link run} stays the typed RPC failure path.
 *
 * ## Two surfaces, one namespace
 *
 * This module is consumed as an Effect **module namespace** (`export * as Daemon`), so member
 * access tree-shakes. It carries two cooperating surfaces:
 * - **Engine** — {@link make} (+ {@link Service}, {@link currentScheduleId}, {@link scheduleControls},
 *   {@link Errors}): construct and run a supervised daemon directly.
 * - **Hyperlink toolkit** — {@link Tag} / {@link Schedule} / {@link schedule} shape a daemon as a
 *   {@link Hyperlink}; declare optional {@link DaemonTagOptions.success} and
 *   {@link DaemonTagOptions.error} on {@link Tag} (positional or config object). Use
 *   {@link layer} / {@link serve} / {@link serveRemote} / {@link configure} to run it locally or over
 *   toolkit's location-transparent layers (the same `yield* Tag` runs local or remote; only the layer
 *   changes). This mirrors `WorkPool`: the light `Daemon.Tag` path pulls no engine code, and the
 *   engine loads only when a runtime verb (`make` / `layer` / `serve`) is referenced.
 *
 * @module Daemon
 */

import {
  Cause,
  Clock,
  Context,
  Data,
  DateTime,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  MutableRef,
  Option,
  PubSub,
  Ref,
  Schema,
  Scope,
  Stream,
  SubscriptionRef,
  pipe,
} from "effect";
import {
  configureLayer,
  configureWrapEffectField,
  foldConfiguredSpec,
  type ConfigPatch,
} from "./HyperlinkConfigure";
import { isPollingLayer, isScheduleLayer } from "./internal/daemonLayerBrand";
import {
  makeDaemonExecutionEvent,
  daemonExecutionEventVoid,
} from "./internal/daemonEvent";
import {
  errorOf,
  errorSym,
  successOf,
  successSym,
} from "./internal/daemonTagSchemas";
import { withLogScope } from "./internal/logs/scope";
import { PollingTag, type PollingService } from "./internal/pollingTag";
import { DaemonSchedule, DaemonScheduleTag } from "./internal/daemonSchedule";
import type {
  DaemonScheduleEntry,
  DaemonScheduleService,
  ReconcileResult,
  ScheduleDefineApi,
} from "./internal/daemonSchedule";
// ── toolkit (Hyperlink) surface — the light contract + heavy layers assembled into `Daemon` ──
import * as Hyperlink from "./Hyperlink";
import { buildRpcGroup, groupSym, specSym } from "./Hyperlink";
import type {
  FlatSpec,
  HandlerContextOf,
  ImplOf,
  Local,
  Method,
  NodeBoundTag,
  RefField,
  HyperlinkTag,
  Spec,
  Subscribable,
} from "./Hyperlink";
import type { NodeKey } from "./Node";
import { LogEntrySchema } from "./LogEntry";
import { facetStoreRegistration } from "./internal/store/facetStore";
import * as Store from "./Store";
import {
  builtInDaemonStoreContract,
  makeDaemonStoreAnalyticsContract,
  daemonStoreEventSchema,
  type DaemonStoreAnalyticsContract,
  type DaemonStoreEvent,
  type DaemonStoreStartedInput,
  type DaemonStoreTerminalInput,
} from "./internal/store/daemonStoreSpec";
import type { StoreScopeTag } from "./internal/store/registration";
import type { StoreShapes } from "./internal/store/contractDef";
// ============================================================================
// Public types
// ============================================================================

/**
 * A one-shot read of a managed daemon's runtime mirror — the observable state the supervisor
 * maintains as it reconciles the schedule and spawns instances. Native (engine-side) types;
 * the toolkit contract ({@link daemonStatus}) maps these to its wire form.
 *
 * @category models
 * @public
 */
export interface DaemonSnapshot {
  /** Whether the schedule currently places the daemon in a run window (derived from entries). */
  readonly armed: boolean;
  /** How many run instances are executing right now. */
  readonly activeInstances: number;
  /** When the next run instance is expected to start (none if disarmed/idle). */
  readonly nextTriggerRun: Option.Option<Date>;
  /** When the schedule next changes armed/disarmed (none if no future transition). */
  readonly nextScheduleTransition: Option.Option<Date>;
  /** The in-instance repeat cadence, when polling is configured (none otherwise). */
  readonly nextPollCadence: Option.Option<Duration.Duration>;
  /** Total effect runs started (scheduled + polling + manual {@link run}) since the layer built. */
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
 * Managed daemon handle for Hyperlink supervision.
 *
 * @typeParam R — Environment required to run {@link Daemon.effect} (after optional inline layers).
 *
 * @category models
 * @public
 */
export interface Daemon<out R> {
  readonly name: string;
  /**
   * Long-running trigger driver that spawns run instances.
   * Execution history is recorded on the **`Daemon.layer`** path via the baked-in default store
   * (override with an app {@link Store.Service} at the root). The direct **`make`** path does not
   * persist runs.
   */
  readonly effect: Effect.Effect<void, never, R>;
  /**
   * Runs the user `effect` once with tracking, independent of trigger cadence.
   * Failures propagate with typed `E` when the tag stamps an `error` schema.
   */
  readonly run: () => Effect.Effect<unknown, never, R>;
  /**
   * One-shot read of the runtime mirror (armed / active instances / next trigger / next schedule
   * transition / poll cadence). Drives the toolkit contract's `status` ref (`status.get` /
   * `status.changes`). Reads the supervisor's live mirror, so it reflects state regardless of who
   * forked {@link Daemon.effect}.
   */
  readonly snapshot: Effect.Effect<DaemonSnapshot>;
  /**
   * Live fan-out of execution lifecycle facts (`Started` / `Completed` / `Failed` / `Interrupted`).
   * Same union as the durable {@link Daemon.store} journal — every publish also records when a
   * store is wired. Sliding buffer: subscribe before runs you care about; the store is durable SSOT.
   */
  readonly events: Stream.Stream<DaemonLiveEvent>;
  /**
   * Cadence controls over the RUNNING supervisor's polling service. `wake` ends the current
   * polling wait immediately (the next tick runs now; cadence unchanged); `resetCadence`
   * returns the preset to its initial state (backoff → `initial`, accelerating → slow) and
   * wakes. Both are no-ops while the driver isn't supervising or no polling layer is wired.
   */
  readonly polling: {
    readonly wake: Effect.Effect<void>;
    readonly resetCadence: Effect.Effect<void>;
  };
}

/**
 * Canonical daemon declaration that can be registered with a typed Hyperlink group.
 *
 * @remarks
 * The declaration carries the daemon handle under {@link daemon} rather than
 * copying handle fields onto the service class. Function/class `name` is a
 * read-only JavaScript property, so storing the runtime handle separately keeps
 * the service class safe while preserving the canonical daemon id.
 *
 * @category models
 * @public
 */
export interface DaemonDefinition<out Id extends string, out R>
{
  readonly id: Id;
  readonly kind: typeof kind;
  readonly daemon: Daemon<R>;
}

/**
 * Canonical daemon service declaration.
 *
 * @remarks
 * This mirrors Effect's class-based `Context.Service` style while attaching the
 * metadata Hyperlink needs for typed registration and contract generation.
 *
 * @category models
 * @public
 */
export interface DaemonServiceDefinition<Self, Id extends string, E, R>
  extends Context.ServiceClass<Self, Id, Daemon<R>>,
    DaemonDefinition<Id, R> {
  readonly tag: Context.Key<Self, Daemon<R>>;
  readonly layer: Layer.Layer<Self>;
  /**
   * Factory defaults before {@link configure} layers (see `HyperlinkConfigure` module).
   */
  readonly defaultSpec: DaemonMakeOptions<E, R>;
  /**
   * Append a configure patch; merge with {@link layer} via `Layer.provideMerge`.
   */
  readonly configure: (
    patch: ConfigPatch<DaemonMakeOptions<E, R>>,
  ) => Layer.Layer<never>;
  /**
   * Patch only the supervised repeat `effect`: `fn(previous) => next`.
   */
  readonly wrapEffect: (
    fn: (
      previous: DaemonMakeOptions<E, R>["effect"],
    ) => DaemonMakeOptions<E, R>["effect"],
  ) => Layer.Layer<never>;
  /**
   * {@link Daemon} built from {@link defaultSpec} after folding configure patches.
   * Hyperlink uses this when assembling the group runtime.
   */
  readonly buildConfiguredDaemon: Effect.Effect<Daemon<R>>;
}

/**
 * Extract service requirements from a {@link Daemon} handle.
 *
 * @category models
 * @public
 */
export type DaemonEffectRequirements<P> = P extends Daemon<infer R> ? R : never;

/**
 * Context for the currently running scheduled window.
 *
 * @category models
 * @public
 */
export interface DaemonScheduleContext {
  readonly id: Option.Option<string>;
}

class DaemonScheduleContextTag extends Context.Service<
  DaemonScheduleContextTag,
  DaemonScheduleContext
>()("hyperlink-ts/Daemon/DaemonScheduleContextTag") {}

class DaemonScheduleControlsTag extends Context.Service<
  DaemonScheduleControlsTag,
  DaemonScheduleControls
>()("hyperlink-ts/Daemon/DaemonScheduleControlsTag") {}

/**
 * Identifier attached to the schedule entry that started the current run.
 *
 * @remarks
 * - For scheduled runs: value from `DaemonScheduleEntry.id`
 * - For manual toolkit {@link run}: `Option.none()`
 *
 * @category schedule
 * @public
 */
export const currentScheduleId: Effect.Effect<Option.Option<string>, never, never> =
  Effect.serviceOption(DaemonScheduleContextTag).pipe(
    Effect.map(
      Option.match({
        onNone: () => Option.none(),
        onSome: (ctx) => ctx.id,
      }),
    ),
  );

/**
 * Schedule controls for the currently running daemon runtime.
 *
 * @remarks
 * Available from both:
 * - `Daemon.make(id, { schedule: (controls) => ... })`
 * - inside the daemon `effect` via this accessor.
 *
 * @category schedule
 * @public
 */
export const scheduleControls: Effect.Effect<DaemonScheduleControls, never, never> =
  Effect.serviceOption(DaemonScheduleControlsTag).pipe(
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

/**
 * @public Thrown when a positional {@link Daemon.make} argument is not a recognized preset layer or schedule initializer.
 *
 * @category errors
 * @public
 */
export class DaemonMakeInvalidLayerArgument extends Data.TaggedError("DaemonMakeInvalidLayerArgument")<{
  /** 1-based index of the invalid argument (`3` or `4`). */
  readonly argumentIndex: 3 | 4;
  readonly reason: string;
}> {}

/**
 * @public Optional polling layer argument to {@link Daemon.make}.
 *
 * @category models
 * @public
 */
export type DaemonPollingInput = Layer.Layer<PollingTag, never, never>;

/**
 * @public Optional schedule layer argument to {@link Daemon.make}.
 *
 * @category models
 * @public
 */
export type DaemonScheduleLayerInput = Layer.Layer<DaemonScheduleTag, never, never>;

/**
 * @public Optional schedule layer or initializer argument to {@link Daemon.make}.
 *
 * @category models
 * @public
 */
export type DaemonScheduleInput<R = never> =
  | DaemonScheduleLayerInput
  | DaemonScheduleInitializer<R>;

type AnyPollingLayer = DaemonPollingInput;
type AnyScheduleLayer = DaemonScheduleLayerInput;

type DaemonMakeLayerArg<RUser> =
  | AnyPollingLayer
  | AnyScheduleLayer
  | DaemonScheduleInitializer<RUser>;

interface DaemonMirror {
  readonly armed: MutableRef.MutableRef<boolean>;
  readonly nextScheduleTransition: MutableRef.MutableRef<Option.Option<Date>>;
  readonly nextPollCadence: MutableRef.MutableRef<Option.Option<Duration.Duration>>;
  readonly activeInstances: MutableRef.MutableRef<number>;
  readonly nextTriggerRun: MutableRef.MutableRef<Option.Option<Date>>;
  // Run metrics — counted once at the single run boundary ({@link trackedProgram}), so they cover
  // scheduled ticks, polling ticks, and manual toolkit {@link run} alike.
  readonly runsStarted: MutableRef.MutableRef<number>;
  readonly runsSucceeded: MutableRef.MutableRef<number>;
  readonly runsFailed: MutableRef.MutableRef<number>;
  readonly lastRunStartedAt: MutableRef.MutableRef<Option.Option<Date>>;
  readonly lastRunDurationMillis: MutableRef.MutableRef<Option.Option<number>>;
}

/**
 * Engine-facing daemon store recorder — Storage-free writes at run boundaries.
 * Built in {@link buildDaemonImpl} from `pipe(Store.effects, Store.catchWriteErrors)` with
 * `Storage` discharged once via {@link Store.provideContext} (queue / gate golden pattern).
 * @internal
 */
interface DaemonStoreWriter<Tag extends StoreScopeTag = StoreScopeTag> {
  readonly record: (event: DaemonStoreEvent<Tag>) => Effect.Effect<void>;
  readonly hasPriorExecutions: () => Effect.Effect<boolean>;
}

/**
 * One daemon execution lifecycle fact — shared by live {@link Daemon.events} and durable store
 * rows (`Started` | `Completed` | `Failed` | `Interrupted`). Tag-stamped `success` / `error`
 * ride `Completed.success?` / `Failed.error` the same way on both surfaces.
 *
 * @category models
 * @public
 */
export type DaemonLiveEvent = DaemonStoreEvent;

interface DaemonBuildStateBase<E, RUser> {
  readonly name: string;
  readonly userEffect: Effect.Effect<void, E, RUser>;
  readonly scheduleInitializer?: DaemonScheduleInitializer<RUser>;
  /** @internal Store recorder when built via {@link layer}. */
  readonly store?: DaemonStoreWriter;
  /** @internal Tag SSOT for store wire schemas when {@link store} is wired. */
  readonly storeScopeTag?: StoreScopeTag;
  /** @internal Latest success value for store capture when the tag stamps `success`. */
  readonly resultRef?: SubscriptionRef.SubscriptionRef<Option.Option<unknown>>;
}

/**
 * User-facing controls for a daemon's schedule — enumerate, set, add, and clear entries.
 *
 * @category models
 * @public
 */
export interface DaemonScheduleControls {
  readonly entries: Effect.Effect<ReadonlyArray<DaemonScheduleEntry>, never, never>;
  readonly set: (
    entries: ReadonlyArray<DaemonScheduleEntry>,
  ) => Effect.Effect<void, never, never>;
  readonly add: (
    entry: DaemonScheduleEntry,
  ) => Effect.Effect<void, never, never>;
  readonly clear: Effect.Effect<void, never, never>;
}

/**
 * A function that seeds a daemon's schedule via its {@link DaemonScheduleControls}.
 *
 * @category models
 * @public
 */
export type DaemonScheduleInitializer<R = never> = (
  controls: DaemonScheduleControls,
) => Effect.Effect<void, never, R>;

type DaemonBuildStateWithPollingAndSchedule<E, RUser> =
  & DaemonBuildStateBase<E, RUser>
  & {
    readonly pollingLayer: AnyPollingLayer;
    readonly scheduleLayer: AnyScheduleLayer;
  };

type DaemonBuildStateWithPolling<E, RUser> =
  & DaemonBuildStateBase<E, RUser>
  & {
    readonly pollingLayer: AnyPollingLayer;
    readonly scheduleLayer?: undefined;
  };

type DaemonBuildStateWithSchedule<E, RUser> =
  & DaemonBuildStateBase<E, RUser>
  & {
    readonly pollingLayer?: undefined;
    readonly scheduleLayer: AnyScheduleLayer;
  };

type DaemonBuildStateWithoutStepLayers<E, RUser> =
  & DaemonBuildStateBase<E, RUser>
  & {
    readonly pollingLayer?: undefined;
    readonly scheduleLayer?: undefined;
  };

type AnyDaemonBuildState<E, RUser> =
  | DaemonBuildStateWithPollingAndSchedule<E, RUser>
  | DaemonBuildStateWithPolling<E, RUser>
  | DaemonBuildStateWithSchedule<E, RUser>
  | DaemonBuildStateWithoutStepLayers<E, RUser>;

const writeScheduleMirror = (
  mirror: DaemonMirror,
  st: { readonly armed: boolean; readonly nextScheduleTransition: Option.Option<Date> },
  nextPollCadence: Option.Option<Duration.Duration>,
): void => {
  MutableRef.set(mirror.armed, st.armed);
  MutableRef.set(mirror.nextScheduleTransition, st.nextScheduleTransition);
  MutableRef.set(mirror.nextPollCadence, nextPollCadence);
};

function createDaemon<E, RUser>(
  state: DaemonBuildStateWithPollingAndSchedule<E, RUser>,
): Daemon<RUser>;
function createDaemon<E, RUser>(
  state: DaemonBuildStateWithPolling<E, RUser>,
): Daemon<RUser>;
function createDaemon<E, RUser>(
  state: DaemonBuildStateWithSchedule<E, RUser>,
): Daemon<RUser>;
function createDaemon<E, RUser>(
  state: DaemonBuildStateWithoutStepLayers<E, RUser>,
): Daemon<RUser>;
function createDaemon<E, RUser>(state: AnyDaemonBuildState<E, RUser>) {
  const toScheduleControls = (
    schedule: DaemonScheduleService,
  ): DaemonScheduleControls => ({
    entries: schedule.entries,
    set: (entries) => schedule.set(entries),
    add: (entry) => schedule.add(entry),
    clear: schedule.clear,
  });

  const noScheduleControls: DaemonScheduleControls = {
    entries: Effect.succeed([]),
    set: () => Effect.void,
    add: () => Effect.void,
    clear: Effect.void,
  };

  const { name, userEffect, store, storeScopeTag, resultRef } = state;

  // The RUNNING driver's polling service — written when the driver builds its step context,
  // cleared when that scope closes. The handle's `polling` controls read it, so wake works
  // regardless of who forked the driver (same contract as the status mirror).
  const pollingRef = MutableRef.make<Option.Option<PollingService>>(Option.none());

  const mirror: DaemonMirror = {
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

  const whenStore = (
    write: (recorder: DaemonStoreWriter) => Effect.Effect<void>,
  ): Effect.Effect<void> =>
    store === undefined ? Effect.void : write(store).pipe(Effect.asVoid);

  const resourceKey = storeScopeTag?.key ?? name;

  // Sliding PubSub: publishing never blocks the driver (drops oldest when a subscriber lags).
  // Guaranteed delivery stays on the durable store — persist == stream at the source (Queue pattern).
  //
  // `Daemon.make` is sync (unlike Queue's Effect-scoped `make`), so we allocate the hub with
  // `Effect.runSync`. In Effect v4, `PubSub.sliding` is an `Effect.sync` constructor with **no**
  // Scope requirement — this is not a scoped leak. Prefer this over making `Daemon.make`
  // Effect-returning solely for hub allocation.
  const eventsHub = Effect.runSync(PubSub.sliding<DaemonLiveEvent>(1024));

  const terminalRow = (input: DaemonStoreTerminalInput) => ({
    key: resourceKey,
    scheduleKey: input.scheduleKey,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    durationMs: input.completedAt - input.startedAt,
    isStartupRun: input.isStartupRun,
  });

  /** Publish to live `events` and append to the store when wired — one path, one union. */
  const publishExecutionEvent = (event: DaemonLiveEvent): Effect.Effect<void> =>
    Effect.gen(function* () {
      yield* PubSub.publish(eventsHub, event);
      yield* whenStore((recorder) => recorder.record(event));
    });

  const recordStoreStarted = (args: DaemonStoreStartedInput): Effect.Effect<void> =>
    publishExecutionEvent({
      _tag: "Started",
      key: resourceKey,
      scheduleKey: args.scheduleKey,
      startedAt: args.startedAt,
      isStartupRun: args.isStartupRun,
    });

  const recordStoreCompleted = (
    args: DaemonStoreTerminalInput & { readonly success?: unknown },
  ): Effect.Effect<void> =>
    publishExecutionEvent({
      _tag: "Completed",
      ...terminalRow(args),
      ...(args.success !== undefined ? { success: args.success } : {}),
    });

  const recordStoreFailed = (args: {
    readonly scheduleKey: string | null;
    readonly startedAt: number;
    readonly completedAt: number;
    readonly isStartupRun: boolean;
    readonly error: unknown;
  }): Effect.Effect<void> =>
    publishExecutionEvent({
      _tag: "Failed",
      ...terminalRow(args),
      error:
        storeScopeTag !== undefined && errorOf(storeScopeTag) !== undefined
          ? args.error
          : String(args.error),
    });

  const recordStoreInterrupted = (args: DaemonStoreTerminalInput): Effect.Effect<void> =>
    publishExecutionEvent({
      _tag: "Interrupted",
      ...terminalRow(args),
    });

  const readHasPriorExecutions = (): Effect.Effect<boolean> =>
    store !== undefined
      ? store.hasPriorExecutions()
      : Effect.succeed(false);

  const trackedProgram = (
    scheduleIdentifier: Option.Option<string>,
    controls: DaemonScheduleControls,
  ): Effect.Effect<unknown, E, RUser> =>
    Effect.gen(function* () {
      const executedAt = yield* Clock.currentTimeMillis;
      MutableRef.update(mirror.runsStarted, (n) => n + 1);
      MutableRef.set(
        mirror.lastRunStartedAt,
        Option.some(DateTime.toDateUtc(DateTime.makeUnsafe(executedAt))),
      );
      const hasPrior = yield* readHasPriorExecutions();
      const isStartupRun = !hasPrior;

      yield* recordStoreStarted({
        scheduleKey: Option.getOrNull(scheduleIdentifier),
        startedAt: executedAt,
        isStartupRun,
      });

      const runUserEffect = userEffect.pipe(
        Effect.provideService(DaemonScheduleContextTag, {
          id: scheduleIdentifier,
        }),
        Effect.provideService(DaemonScheduleControlsTag, controls),
        Effect.onInterrupt(() =>
          Effect.uninterruptible(
            Effect.gen(function* () {
              const completedAt = yield* Clock.currentTimeMillis;
              MutableRef.set(
                mirror.lastRunDurationMillis,
                Option.some(completedAt - executedAt),
              );
              yield* recordStoreInterrupted({
                scheduleKey: Option.getOrNull(scheduleIdentifier),
                startedAt: executedAt,
                completedAt,
                isStartupRun,
              });
              yield* Effect.logDebug(
                `⏹ Daemon '${name}' run interrupted at ${String(executedAt)}`,
              );
            }),
          ),
        ),
      );

      const exit = yield* Effect.exit(runUserEffect);

      return yield* Effect.uninterruptible(
        Effect.gen(function* () {
          if (Exit.isFailure(exit)) {
            const cause = exit.cause;
            if (Cause.hasInterrupts(cause)) {
              return yield* Effect.failCause(cause);
            }
            const completedAt = yield* Clock.currentTimeMillis;
            MutableRef.update(mirror.runsFailed, (n) => n + 1);
            MutableRef.set(
              mirror.lastRunDurationMillis,
              Option.some(completedAt - executedAt),
            );
            const error = Option.getOrElse(Cause.findErrorOption(cause), () =>
              Cause.squash(cause),
            );
            yield* recordStoreFailed({
              scheduleKey: Option.getOrNull(scheduleIdentifier),
              startedAt: executedAt,
              completedAt,
              error,
              isStartupRun,
            });
            yield* Effect.logError(
              `❌ Daemon '${name}' run failed at ${String(executedAt)}: ${String(error)}`,
            );
            return yield* Effect.fail(error as E);
          }
          const completedAt = yield* Clock.currentTimeMillis;
          MutableRef.update(mirror.runsSucceeded, (n) => n + 1);
          MutableRef.set(
            mirror.lastRunDurationMillis,
            Option.some(completedAt - executedAt),
          );
          const successValue =
            resultRef !== undefined
              ? Option.getOrUndefined(yield* SubscriptionRef.get(resultRef))
              : Exit.isSuccess(exit)
                ? exit.value
                : undefined;
          yield* recordStoreCompleted({
            scheduleKey: Option.getOrNull(scheduleIdentifier),
            startedAt: executedAt,
            completedAt,
            isStartupRun,
            ...(storeScopeTag !== undefined &&
            successOf(storeScopeTag) !== undefined &&
            successValue !== undefined
              ? { success: successValue }
              : {}),
          });
          yield* Effect.logDebug(
            `✅ Daemon '${name}' run completed at ${String(executedAt)}`,
          );
          return successValue;
        }),
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
    entries: ReadonlyArray<DaemonScheduleEntry>,
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
    entries: ReadonlyArray<DaemonScheduleEntry>,
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
    entry: DaemonScheduleEntry,
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
    readonly entry: DaemonScheduleEntry;
  }

  const materializeEntries = (
    entries: ReadonlyArray<DaemonScheduleEntry>,
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
    entry: DaemonScheduleEntry,
    controls: DaemonScheduleControls,
  ): Effect.Effect<void, never, RUser | PollingTag | DaemonScheduleTag | Clock.Clock> =>
    Effect.gen(function* () {
      if (MutableRef.get(runningByEntry).has(key)) {
        return;
      }

      const runEntryInstance = Effect.gen(function* () {
        const pollingOption = yield* Effect.serviceOption(PollingTag);

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
            yield* trackedProgram(entry.id, controls).pipe(Effect.catch(() => Effect.void));
          }
          return;
        }

        const polling = pollingOption.value;
        for (;;) {
          if (!(yield* canContinue)) {
            return;
          }

          const schedule = yield* DaemonSchedule;
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
          yield* trackedProgram(entry.id, controls).pipe(Effect.catch(() => Effect.void));
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
    entry: DaemonScheduleEntry,
    controls: DaemonScheduleControls,
  ): Effect.Effect<void, never, RUser | PollingTag | DaemonScheduleTag | Clock.Clock> =>
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
    RUser | PollingTag | DaemonScheduleTag | Clock.Clock
  > = Effect.gen(function* () {
    const schedule = yield* DaemonSchedule;
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
    RUser | PollingTag | DaemonScheduleTag | Clock.Clock
  > = Effect.gen(function* () {
    const schedule = yield* DaemonSchedule;
    const controls = toScheduleControls(schedule);
    if (state.scheduleInitializer !== undefined) {
      yield* state.scheduleInitializer(controls);
    }
    for (;;) {
      yield* reconcileSchedules;
      yield* schedule.changed;
    }
  });

  const run = (): Effect.Effect<unknown, E, RUser> =>
    Effect.gen(function* () {
      yield* Effect.logInfo(
        `🚀 Running '${name}' immediately (tracked; independent of trigger)...`,
      );
      const result = yield* trackedProgram(Option.none(), noScheduleControls);
      yield* Effect.logDebug(`✅ Completed immediate run of '${name}'`);
      return result;
    });

  const snapshot: Effect.Effect<DaemonSnapshot> = Effect.sync(() => ({
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

  const events: Stream.Stream<DaemonLiveEvent> = Stream.fromPubSub(eventsHub);

  const withPolling = (use: (svc: PollingService) => Effect.Effect<void>): Effect.Effect<void> =>
    Effect.suspend(() =>
      Option.match(MutableRef.get(pollingRef), {
        onNone: () => Effect.void,
        onSome: use,
      }),
    );
  const base = {
    name,
    run,
    snapshot,
    events,
    polling: {
      wake: withPolling((svc) => svc.requestWake),
      resetCadence: withPolling((svc) => svc.resetCadence),
    },
  };

  const annotateDaemonLogs = (
    effect: Effect.Effect<void, never, RUser | PollingTag | DaemonScheduleTag | Clock.Clock>,
  ): Effect.Effect<void, never, RUser | PollingTag | DaemonScheduleTag | Clock.Clock> =>
    withLogScope({ key: name })(effect);

  // Provide whichever step layers are present (polling / schedule), forwarding the residual `RUser`.
  // Built + provided as its Context in expression position (NOT `Effect.provide(core, stepLayer)`:
  // `strictEffectProvide` reserves the layer form for entry points). Inlined rather than routed through
  // a generic helper on purpose — with `supervisedCore`/`stepLayer` concrete here the residual
  // `Exclude<…, ROut>` computes to a real union, so `missingEffectContext` sees it's forwarded, not
  // leaked; on the generic helper it couldn't tell the two apart and false-flagged. `annotateDaemonLogs`
  // then widens back to the full union, so that residual precision is never observed downstream anyway.
  const stepLayer =
    state.pollingLayer !== undefined && state.scheduleLayer !== undefined
      ? Layer.mergeAll(state.pollingLayer, state.scheduleLayer)
      : state.pollingLayer ?? state.scheduleLayer ?? Layer.empty;
  return {
    ...base,
    effect: annotateDaemonLogs(
      Effect.scoped(
        Effect.flatMap(Layer.build(stepLayer), (context) => {
          MutableRef.set(pollingRef, Context.getOption(context, PollingTag));
          return Effect.provide(supervisedCore, context).pipe(
            Effect.ensuring(Effect.sync(() => MutableRef.set(pollingRef, Option.none()))),
          );
        }),
      ),
    ),
  };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Services still required at the fork site for {@link Daemon.effect} for a given
 * {@link DaemonMakeConfig}.
 *
 * @category models
 * @public
 */
// `E` is covariant in `Effect.Effect<void, E, RUser>` (top = `unknown`),
// `RUser` is contravariant (top = `never`); using these as the upper bound
// makes the constraint variance-correct without resorting to `any`.
export type DaemonSupervisorRequirements<C extends DaemonMakeOptions<unknown, never>> =
  C extends DaemonMakeOptions<infer _E, infer RUser>
    ? RUser
    : never;

/**
 * Configuration for {@link Daemon.make} when using the config-object form (id is separate).
 *
 * @category models
 * @public
 */
export interface DaemonMakeOptions<E, RUser> {
  readonly effect: Effect.Effect<void, E, RUser>;
  /**
   * @internal Wired by {@link layer} for store-backed execution history.
   * Not part of the public {@link make} API.
   */
  readonly _store?: DaemonStoreWriter;
  /** @internal Tag SSOT paired with {@link _store}. */
  readonly _storeScopeTag?: StoreScopeTag;
  /** @internal Success ref paired with value-returning layer builds. */
  readonly _resultRef?: SubscriptionRef.SubscriptionRef<Option.Option<unknown>>;
  /** Optional polling layer for in-instance repeat cadence. */
  readonly polling?: AnyPollingLayer;
  /**
   * Optional schedule layer or initializer.
   *
   * When omitted, defaults to {@link DaemonSchedule.alwaysArmed}. Use
   * {@link DaemonSchedule.empty} or {@link DaemonSchedule.inMemory} for an
   * empty store (disarmed until entries are added).
   */
  readonly schedule?: DaemonScheduleInitializer<RUser> | AnyScheduleLayer;
  /**
   * Explicit schedule service layer. When set, takes precedence over `schedule`.
   *
   * When both `schedule` and `scheduleLayer` are omitted,
   * {@link DaemonSchedule.alwaysArmed} is used.
   */
  readonly scheduleLayer?: AnyScheduleLayer;
}

/** @internal Resolved id + {@link DaemonMakeOptions} for supervisor wiring. */
export type DaemonMakeConfig<E, RUser> = DaemonMakeOptions<E, RUser> & {
  readonly name: string;
};

const resolveScheduleLayer = <E, RUser>(
  config: Pick<DaemonMakeOptions<E, RUser>, "schedule" | "scheduleLayer">,
): AnyScheduleLayer => {
  if (config.scheduleLayer !== undefined) {
    return config.scheduleLayer;
  }
  if (typeof config.schedule === "function") {
    return DaemonSchedule.inMemory();
  }
  if (config.schedule !== undefined) {
    return config.schedule;
  }
  return DaemonSchedule.alwaysArmed;
};

const buildDaemon = <E, RUser>(
  name: string,
  config: DaemonMakeOptions<E, RUser>,
): Daemon<RUser> => {
  const scheduleInitializer = typeof config.schedule === "function"
    ? config.schedule
    : undefined;
  const scheduleLayer = resolveScheduleLayer(config);
  if (config.polling !== undefined) {
    return createDaemon({
      name,
      userEffect: config.effect,
      pollingLayer: config.polling,
      scheduleLayer,
      scheduleInitializer,
      store: config._store,
      storeScopeTag: config._storeScopeTag,
      resultRef: config._resultRef,
    });
  }
  return createDaemon({
    name,
    userEffect: config.effect,
    scheduleLayer,
    scheduleInitializer,
    store: config._store,
    storeScopeTag: config._storeScopeTag,
    resultRef: config._resultRef,
  });
};

const collectPollingAndSchedule = <RUser>(
  third?: DaemonMakeLayerArg<RUser>,
  fourth?: DaemonMakeLayerArg<RUser>,
): Pick<DaemonMakeOptions<never, RUser>, "polling" | "schedule" | "scheduleLayer"> => {
  let polling: AnyPollingLayer | undefined;
  let schedule: DaemonScheduleInitializer<RUser> | undefined;
  let scheduleLayer: AnyScheduleLayer | undefined;

  const fail = (argumentIndex: 3 | 4, reason: string): never => {
    throw new DaemonMakeInvalidLayerArgument({ argumentIndex, reason });
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
      "expected a Polling preset layer, DaemonSchedule preset layer, or schedule initializer function",
    );
  }

  return {
    ...(polling !== undefined ? { polling } : {}),
    ...(schedule !== undefined ? { schedule } : {}),
    ...(scheduleLayer !== undefined ? { scheduleLayer } : {}),
  };
};

const resolveDaemonMakeConfig = <E, RUser>(
  effectOrConfig: Effect.Effect<void, E, RUser> | DaemonMakeOptions<E, RUser>,
  third?: DaemonMakeLayerArg<RUser>,
  fourth?: DaemonMakeLayerArg<RUser>,
): DaemonMakeOptions<E, RUser> => {
  if (Effect.isEffect(effectOrConfig)) {
    return {
      effect: effectOrConfig,
      ...collectPollingAndSchedule(third, fourth),
    };
  }
  return effectOrConfig;
};

/**
 * Create a managed {@link Daemon}.
 *
 * @category constructors
 * @public
 */
function make<const Id extends string, E, RUser>(
  id: Id,
  effect: Effect.Effect<void, E, RUser>,
): Daemon<RUser>;
function make<const Id extends string, E, RUser>(
  id: Id,
  effect: Effect.Effect<void, E, RUser>,
  polling: AnyPollingLayer,
): Daemon<RUser>;
function make<const Id extends string, E, RUser>(
  id: Id,
  effect: Effect.Effect<void, E, RUser>,
  schedule: AnyScheduleLayer,
): Daemon<RUser>;
function make<const Id extends string, E, RUser, RSchedule>(
  id: Id,
  effect: Effect.Effect<void, E, RUser>,
  schedule: DaemonScheduleInitializer<RSchedule>,
): Daemon<RUser | RSchedule>;
function make<const Id extends string, E, RUser>(
  id: Id,
  effect: Effect.Effect<void, E, RUser>,
  polling: AnyPollingLayer,
  schedule: AnyScheduleLayer,
): Daemon<RUser>;
function make<const Id extends string, E, RUser, RSchedule>(
  id: Id,
  effect: Effect.Effect<void, E, RUser>,
  polling: AnyPollingLayer,
  schedule: DaemonScheduleInitializer<RSchedule>,
): Daemon<RUser | RSchedule>;
function make<const Id extends string, E, RUser>(
  id: Id,
  effect: Effect.Effect<void, E, RUser>,
  schedule: AnyScheduleLayer,
  polling: AnyPollingLayer,
): Daemon<RUser>;
function make<const Id extends string, E, RUser, RSchedule>(
  id: Id,
  effect: Effect.Effect<void, E, RUser>,
  schedule: DaemonScheduleInitializer<RSchedule>,
  polling: AnyPollingLayer,
): Daemon<RUser | RSchedule>;
function make<const Id extends string, E, RUser>(
  id: Id,
  config: DaemonMakeOptions<E, RUser>,
): Daemon<RUser>;
function make<const Id extends string, E, RUser>(
  id: Id,
  effectOrConfig: Effect.Effect<void, E, RUser> | DaemonMakeOptions<E, RUser>,
  third?: DaemonMakeLayerArg<RUser>,
  fourth?: DaemonMakeLayerArg<RUser>,
): Daemon<RUser> {
  return buildDaemon(id, resolveDaemonMakeConfig(effectOrConfig, third, fourth));
}

/**
 *
 * @category models
 * @public
 */
export type DaemonMake = typeof make;

/**
 * The Daemon resource kind — the single source of truth (also the module's public `kind`).
 * The definition carries it and Hyperlink / the dashboard match on it; there is no
 * second short discriminator.
 *
 * @category utils
 * @public
 */
export const kind = "hyperlink-ts/Daemon" as const;

const makeDaemonDefinition = <const Id extends string, E, RUser>(
  id: Id,
  config: DaemonMakeOptions<E, RUser>,
): DaemonDefinition<Id, RUser> => {
  const daemon = make(id, config);
  return {
    id,
    kind,
    daemon,
  };
};

const defineDaemonService = <Self>() => {
  function service<const Id extends string, E, RUser>(
    id: Id,
    effect: Effect.Effect<void, E, RUser>,
  ): DaemonServiceDefinition<Self, Id, E, RUser>;
  function service<const Id extends string, E, RUser>(
    id: Id,
    effect: Effect.Effect<void, E, RUser>,
    polling: AnyPollingLayer,
  ): DaemonServiceDefinition<Self, Id, E, RUser>;
  function service<const Id extends string, E, RUser>(
    id: Id,
    effect: Effect.Effect<void, E, RUser>,
    schedule: AnyScheduleLayer,
  ): DaemonServiceDefinition<Self, Id, E, RUser>;
  function service<const Id extends string, E, RUser, RSchedule>(
    id: Id,
    effect: Effect.Effect<void, E, RUser>,
    schedule: DaemonScheduleInitializer<RSchedule>,
  ): DaemonServiceDefinition<Self, Id, E, RUser | RSchedule>;
  function service<const Id extends string, E, RUser>(
    id: Id,
    effect: Effect.Effect<void, E, RUser>,
    polling: AnyPollingLayer,
    schedule: AnyScheduleLayer,
  ): DaemonServiceDefinition<Self, Id, E, RUser>;
  function service<const Id extends string, E, RUser, RSchedule>(
    id: Id,
    effect: Effect.Effect<void, E, RUser>,
    polling: AnyPollingLayer,
    schedule: DaemonScheduleInitializer<RSchedule>,
  ): DaemonServiceDefinition<Self, Id, E, RUser | RSchedule>;
  function service<const Id extends string, E, RUser>(
    id: Id,
    effect: Effect.Effect<void, E, RUser>,
    schedule: AnyScheduleLayer,
    polling: AnyPollingLayer,
  ): DaemonServiceDefinition<Self, Id, E, RUser>;
  function service<const Id extends string, E, RUser, RSchedule>(
    id: Id,
    effect: Effect.Effect<void, E, RUser>,
    schedule: DaemonScheduleInitializer<RSchedule>,
    polling: AnyPollingLayer,
  ): DaemonServiceDefinition<Self, Id, E, RUser | RSchedule>;
  function service<const Id extends string, E, RUser>(
    id: Id,
    config: DaemonMakeOptions<E, RUser>,
  ): DaemonServiceDefinition<Self, Id, E, RUser>;
  function service<const Id extends string, E, RUser>(
    id: Id,
    effectOrConfig: Effect.Effect<void, E, RUser> | DaemonMakeOptions<E, RUser>,
    third?: DaemonMakeLayerArg<RUser>,
    fourth?: DaemonMakeLayerArg<RUser>,
  ): DaemonServiceDefinition<Self, Id, E, RUser> {
    const defaultSpec = resolveDaemonMakeConfig(effectOrConfig, third, fourth);
    const definition = makeDaemonDefinition(id, defaultSpec);
    const buildConfiguredDaemon = foldConfiguredSpec(id, defaultSpec).pipe(
      Effect.map((effective) => make(id, effective)),
    );
    const base = Context.Service<Self, Daemon<RUser>>()(id);
    return Object.assign(base, {
      ...definition,
      tag: base,
      defaultSpec,
      configure: (patch: ConfigPatch<DaemonMakeOptions<E, RUser>>) =>
        configureLayer(id, patch),
      wrapEffect: (
        fn: (
          previous: DaemonMakeOptions<E, RUser>["effect"],
        ) => DaemonMakeOptions<E, RUser>["effect"],
      ) => configureWrapEffectField(id, fn),
      buildConfiguredDaemon,
      layer: Layer.effect(base)(buildConfiguredDaemon),
    });
  }
  return service;
};

/**
 *
 * @category models
 * @public
 */
export type DaemonServiceBuilder<Self> = ReturnType<typeof defineDaemonService<Self>>;

/**
 *
 * @category models
 * @public
 */
export type DaemonServiceFactory = typeof defineDaemonService;

// ============================================================================
// Engine surface (top-level exports)
//
// `Daemon` is a module namespace (Effect-style — the barrel does `export * as Daemon`), so the
// engine helpers here and the Hyperlink toolkit below are all its members: `Daemon.make`,
// `Daemon.Service`, `Daemon.currentScheduleId`, `Daemon.scheduleControls`, `Daemon.Tag`,
// `Daemon.schedule`, `Daemon.layer`, … Member access tree-shakes — a `Daemon.Tag`-only consumer
// pulls no engine code, mirroring `WorkPool`.
// ============================================================================

export { make };
export { defineDaemonService as Service };

/**
 * Engine errors thrown by {@link make}.
 *
 * @category errors
 * @public
 */
export const Errors = {
  DaemonMakeInvalidLayerArgument,
} as const;

// ############################################################################
// #                                                                          #
// #  Hyperlink toolkit — the light contract (schemas / specs / combinators /  #
// #  Tag / Schedule) plus the heavy layers (layer / serve / serveRemote).    #
// #  A daemon is a Hyperlink: driven locally or remotely over RPC through    #
// #  the toolkit's location-transparent layers, exactly like WorkPool.  #
// #                                                                          #
// ############################################################################

// ============================================================================
// Wire schemas
// ============================================================================

/**
 * One scheduled run window on the wire — the wire form of the engine's {@link DaemonScheduleEntry}.
 * The engine models `id` / `stopAt` as `Option` and the times as `Date`; the toolkit standard is
 * `DateTime.Utc` and `optionalKey`, so the runtime maps between them. `startAt` is when the run
 * instance triggers; `stopAt` (absent = open-ended) is when it stops.
 *
 * @category schedule
 * @public
 */
export const daemonScheduleEntry = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  startAt: Schema.DateTimeUtc,
  stopAt: Schema.optionalKey(Schema.DateTimeUtc),
});

/**
 * The current-state snapshot of a managed daemon — the wire form of the engine's
 * {@link DaemonSnapshot} (plus `supervising`). The element of the reactive `status` field:
 * `status.get` reads it once, `status.changes` streams it.
 *
 * @category wire schemas
 * @public
 */
export const daemonStatus = Schema.Struct({
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
 * Log entry wire schema — alias of {@link LogEntrySchema}. Per-resource logs use {@link Hyperlink.logs}.
 *
 * @category wire schemas
 * @public
 */
export const daemonLogEntry = LogEntrySchema;

/**
 * Execution event union for void processes (no `success` field on `Completed`).
 *
 * @category wire schemas
 * @public
 */
export const daemonExecutionEvent = daemonExecutionEventVoid;

/**
 *
 * @category models
 * @public
 */
export type DaemonExecutionEvent = typeof daemonExecutionEventVoid.Type;

/**
 * Build an execution event union when the daemon tag carries a {@link DaemonTagOptions.success}.
 *
 * @category wire schemas
 * @public
 */
export const daemonExecutionEventFor = makeDaemonExecutionEvent;

/**
 * This contract's canonical **kind** for a standalone {@link Schedule} resource.
 *
 * @category schedule
 * @public
 */
export const scheduleKind = "hyperlink-ts/Daemon/Schedule";

// ============================================================================
// Base daemon spec (observation + lifecycle — no schedule verbs)
// ============================================================================

/**
 * The **base** daemon control + observation contract — shared by every daemon. Mirrors the
 * observable/controllable seams the engine supervisor exposes ({@link DaemonSnapshot} + lifecycle).
 * A base daemon has **no** schedule mutation verbs: arm/disarm is done by mutating a schedule, so
 * those verbs appear only when a daemon {@link schedule | owns an inline schedule}.
 *
 * @category wire schemas
 * @public
 */
export const daemonControlSpec = {
  // ── live current state — one SubscriptionRef-backed source of truth ──
  // `status` is the whole snapshot; `status.get` reads it once, `status.changes` streams every
  // change (uniform local + remote), mirroring the queue's `status` ref.
  status: Hyperlink.ref(daemonStatus).annotate({
    description:
      "Live current-state snapshot: supervising, armed, active instances, next trigger/transition, " +
      "poll cadence, and cumulative run metrics.",
  }),

  // ── lifecycle commands ──
  start: Hyperlink.effect(Schema.Void).annotate({
    description: "Begin supervising — fork the trigger driver (idempotent).",
  }),
  stop: Hyperlink.effect(Schema.Void).annotate({
    description: "Stop supervising — interrupt the driver and any active run instances.",
    destructive: true,
  }),

  // ── cadence commands (no-ops while not supervising / no polling layer) ──
  wake: Hyperlink.effect(Schema.Void).annotate({
    description:
      "End the current polling wait immediately — the next tick runs now; cadence unchanged.",
  }),
  resetCadence: Hyperlink.effect(Schema.Void).annotate({
    description:
      "Reset the cadence preset to its initial state (backoff → initial, accelerating → slow) and wake.",
  }),
};

/**
 * Build a daemon **instance** spec — control surface, live {@link events} stream, and a typed
 * manual {@link run} RPC. Event element schema matches the durable store union
 * ({@link daemonExecutionEventFor} with the tag's optional `success` / `error`).
 *
 * @category wire schemas
 * @public
 */
export const buildDaemonSpec = <
  A extends Schema.Top = typeof Schema.Void,
  E extends Schema.Top = typeof Schema.Never,
>(wire?: {
  readonly success?: A;
  readonly error?: E;
}) => {
  // Same schema helper as the durable store (`daemonStoreEventSchema`) so persist == stream on the wire.
  const eventSchema = daemonStoreEventSchema(wire?.success, wire?.error);
  return {
    ...daemonControlSpec,
    events: Hyperlink.stream(eventSchema).annotate({
      description:
        "Live execution lifecycle (Started / Completed / Failed / Interrupted). Same union as the " +
        "durable Daemon.store journal — persist == stream.",
    }),
    run: (wire?.error !== undefined
      ? Hyperlink.effect(wire?.success ?? Schema.Void, wire.error)
      : Hyperlink.effect(wire?.success ?? Schema.Void)
    ).annotate({
      description:
        "Run the daemon worker effect once, tracked — returns success; failures typed on error.",
    }),
  };
};

/**
 * Erased baseline daemon spec (`Void` success, `Never` error).
 *
 * @category wire schemas
 * @public
 */
export const daemonSpec = buildDaemonSpec();
// Note: no `satisfies Spec` — it contextually widens each method's error channel to `unknown`.
// The spec is validated (without widening) at the `Hyperlink.Tag` call site.

/**
 * The base (schedule-less, result-less) daemon spec.
 *
 * @category models
 * @public
 */
export type DaemonSpec = typeof daemonSpec;

// ============================================================================
// Tag options + schema stamps
// ============================================================================

/**
 * Options for {@link Tag} — use as the sole 2nd argument (config-object overload) or merge with
 * positional `success` / `error` args.
 *
 * @category models
 * @public
 */
export type DaemonTagOptions = {
  readonly description?: string;
  readonly success?: Schema.Top;
  readonly error?: Schema.Top;
  readonly node?: NodeKey<unknown>;
};

/** Read the success schema stamped on a daemon tag, if any. @public */
export { successOf, errorOf };

// ============================================================================
// The `schedule` verb group (grafted onto a daemon that owns an inline schedule)
// ============================================================================

/**
 * The schedule mutation verbs a daemon gains when it {@link schedule | owns an inline schedule}.
 * Reading is `entries` (reactive); mutation is `set` / `add` / `clear`. This is how you arm/disarm:
 * `armed` is derived from the entries, so arming is done by mutating them.
 *
 * @category schedule
 * @public
 */
export const scheduleGroupSpec = {
  entries: Hyperlink.ref(Schema.Array(daemonScheduleEntry)).annotate({
    description: "The daemon's current schedule entries (run windows), reactive.",
  }),
  set: Hyperlink.effectFn(Schema.Array(daemonScheduleEntry)).annotate({
    description: "Replace all schedule entries.",
  }),
  add: Hyperlink.effectFn(daemonScheduleEntry).annotate({
    description: "Append one schedule entry.",
  }),
  clear: Hyperlink.effect(Schema.Void).annotate({
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
 * one or more processes can be gated by. Mirrors the engine's {@link DaemonScheduleService}.
 *
 * @category schedule
 * @public
 */
export const scheduleHyperlinkSpec = {
  entries: Hyperlink.ref(Schema.Array(daemonScheduleEntry)).annotate({
    description: "All schedule entries (run windows), reactive.",
  }),
  get: Hyperlink.effectFn({ id: Schema.String }, Schema.Option(daemonScheduleEntry)).annotate({
    description: "Look up a single entry by id (absent if none matches).",
  }),
  has: Hyperlink.effectFn({ id: Schema.String }, Schema.Boolean).annotate({
    description: "Whether an entry with the given id exists.",
  }),
  set: Hyperlink.effectFn(Schema.Array(daemonScheduleEntry)).annotate({
    description: "Replace all schedule entries.",
  }),
  add: Hyperlink.effectFn(daemonScheduleEntry).annotate({
    description: "Append one schedule entry.",
  }),
  upsert: Hyperlink.effectFn(daemonScheduleEntry).annotate({
    description: "Insert or replace an entry, keyed by its id.",
  }),
  remove: Hyperlink.effectFn({ id: Schema.String }, Schema.Boolean).annotate({
    description: "Remove the entry with the given id; returns whether one was removed.",
    destructive: true,
  }),
  removeMany: Hyperlink.effectFn(Schema.Array(Schema.String), Schema.Number).annotate({
    description: "Remove every entry whose id is listed; returns the count removed.",
    destructive: true,
  }),
  clear: Hyperlink.effect(Schema.Void).annotate({
    description: "Remove all schedule entries.",
    destructive: true,
  }),
};
// Note: no `satisfies Spec` — it contextually widens each method's error channel to `unknown`.
// The spec is validated (without widening) at the `Hyperlink.Tag` call site.

/**
 * The standalone {@link Schedule} resource's spec.
 *
 * @category models
 * @public
 */
export type ScheduleHyperlinkSpec = typeof scheduleHyperlinkSpec;

// ============================================================================
// The `result` field (grafted onto a value-returning daemon)
// ============================================================================

/** The reactive `result` field a value-returning daemon gains via {@link result}. */
type ResultField<A extends Schema.Top> = RefField<
  Method<undefined, Schema.Option<A>, typeof Schema.Never, true>
>;

/** The `result` field as a {@link Spec} fragment (what {@link result} grafts). */
type ResultGroupSpec<A extends Schema.Top> = { readonly result: ResultField<A> };

/**
 * Per-tag daemon spec — control surface, live `events`, plus stamped `run` success/error on the wire.
 *
 * @category models
 * @public
 */
export type DaemonInstanceSpec<
  A extends Schema.Top = typeof Schema.Void,
  E extends Schema.Top = typeof Schema.Never,
> = typeof daemonControlSpec & {
  readonly events: ReturnType<typeof buildDaemonSpec<A, E>>["events"];
  readonly run: Hyperlink.Method<undefined, A, E>;
} & (A extends typeof Schema.Void ? Record<string, never> : ResultGroupSpec<A>);

// ============================================================================
// Schedule windows (entry templates) — id optional
// ============================================================================

/**
 * A schedule **window** template produced by {@link at} / {@link window} — the declarative form of
 * a schedule entry. `id` is **optional** (a nameless window is `add`/`set`/`clear`'d and matched by
 * reference, but is invisible to id-keyed ops). The runtime maps these to the engine's native
 * {@link DaemonScheduleEntry}.
 *
 * @category models
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
 * Daemon.at(startDate)            // nameless
 * Daemon.at("daily-2am", startDate)
 * ```
 *
 * @category schedule
 * @public
 */
export function at(startAt: Date): ScheduleWindow;
export function at(id: string, startAt: Date): ScheduleWindow;
export function at(idOrStartAt: string | Date, maybeStartAt?: Date): ScheduleWindow {
  if (idOrStartAt instanceof Date) {
    return { id: Option.none(), startAt: idOrStartAt, stopAt: Option.none() };
  }
  if (maybeStartAt === undefined) {
    throw new Error("Daemon.at(id, startAt): startAt is required");
  }
  return { id: toWindowId(idOrStartAt), startAt: maybeStartAt, stopAt: Option.none() };
}

/**
 * A **bounded** window (`start` + `stop`). The leading `id` is optional.
 *
 * ```ts
 * Daemon.window(gameStart, gameEnd)            // nameless
 * Daemon.window("game-123", gameStart, gameEnd)
 * ```
 *
 * @category schedule
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
    throw new Error("Daemon.window(id, startAt, stopAt): stopAt is required");
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
 * @category models
 * @public
 */
export type ScheduleEntry = DaemonScheduleEntry;

/**
 * The engine schedule **service** — run-window storage + controls (`entries` / `changed` / CRUD /
 * `reconcile`) that a {@link make} supervisor watches for arming decisions. Materialized by the
 * schedule-layer constructors below and injected via {@link DaemonMakeOptions.scheduleLayer}.
 *
 * @category models
 * @public
 */
export type ScheduleService = DaemonScheduleService;

/**
 * The subset of schedule controls handed to a {@link DaemonScheduleInitializer}
 * (`entries` / `set` / `add` / `clear`) and available inside the daemon effect via
 * {@link scheduleControls}.
 *
 * @category models
 * @public
 */
export type ScheduleControls = DaemonScheduleControls;

/**
 * The diff produced by {@link ScheduleService.reconcile} — the entry ids that were
 * added / updated / removed / left unchanged.
 *
 * @category models
 * @public
 */
export type ScheduleReconcileResult = ReconcileResult;

// These re-expose the internal engine schedule constructors for `make`'s `scheduleLayer`. They are
// deliberately **lazy wrappers** (not `= DaemonSchedule.x`): a direct re-export would reference the
// engine at module load, defeating tree-shaking so a `Daemon.Tag`-only import would drag the engine
// schedule primitive into the bundle. Wrapping keeps the reference inside an eliminable function body.

/**
 * An **in-memory** schedule layer seeded with `entries` — the `Layer` you hand to {@link make}'s
 * `scheduleLayer`. Call with no argument for an **empty** schedule (disarmed until an entry is added
 * via `set` / `add` / `reconcile` or a schedule initializer). Mutable at runtime through the schedule
 * controls (`Daemon.scheduleControls`, the inline `schedule` verbs, or a {@link Schedule} resource).
 *
 * @category schedule
 * @public
 */
export const scheduleInMemory = (
  entries?: ReadonlyArray<ScheduleEntry>,
): DaemonScheduleLayerInput => DaemonSchedule.inMemory(entries);

/**
 * A **declarative** schedule layer from a builder DSL:
 * `Daemon.scheduleDefine(({ at, window }) => [at("daily", d), window("game", start, end)])`.
 *
 * @category schedule
 * @public
 */
export const scheduleDefine = (
  build: (api: ScheduleDefineApi) => ReadonlyArray<ScheduleEntry>,
): DaemonScheduleLayerInput => DaemonSchedule.define(build);

// ============================================================================
// Combinator plumbing: augment a tag's spec (rebuild the flat spec + RPC group)
// ============================================================================

/** Where a daemon tag's schedule mode (inline windows vs external reference) is stowed. @internal */
const scheduleModeSym: unique symbol = Symbol.for(
  "hyperlink-ts/Daemon/scheduleMode",
);

/** @internal */
const isDaemonTagOptions = (value: unknown): value is DaemonTagOptions =>
  typeof value === "object" &&
  value !== null &&
  !Schema.isSchema(value) &&
  ("description" in value ||
    "node" in value ||
    "success" in value ||
    "error" in value);

/** Graft `result` ref + stamp wire schemas on a daemon tag. @internal */
const applyDaemonTagSchemas = (
  tag: HyperlinkTag<any, any, any>,
  schemas: {
    readonly success?: Schema.Top;
    readonly error?: Schema.Top;
  },
): HyperlinkTag<any, any, any> => {
  let next = tag;
  const stamp: Partial<Record<typeof successSym | typeof errorSym, Schema.Top>> =
    {};
  if (schemas.success !== undefined) {
    next = augmentTag(
      next,
      {
        result: Hyperlink.ref(Schema.Option(schemas.success)).annotate({
          description:
            "The latest value the daemon effect resolved to (absent until the first run completes).",
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
const withDaemonReadiness = (
  tag: HyperlinkTag<any, DaemonSpec>,
): HyperlinkTag<any, DaemonSpec> =>
  Hyperlink.withReadiness(tag, (svc: ImplOf<DaemonSpec>) =>
    Effect.map(svc.status.get, (s) => ({
      ready: s.supervising,
      ...(s.supervising ? {} : { detail: "not supervising" }),
    })),
  );

/** @internal */
const buildDaemonTag = <Self>(
  key: string,
  options: DaemonTagOptions | undefined,
  positional: {
    readonly success?: Schema.Top;
    readonly error?: Schema.Top;
  } = {},
): HyperlinkTag<any, any, any> | NodeBoundTag<any, any, unknown, any> => {
  const node = options?.node;
  const tagOptions = { description: options?.description, kind };
  const success = positional.success ?? options?.success;
  const error = positional.error ?? options?.error;
  const spec = buildDaemonSpec({ success, error });
  const base: HyperlinkTag<any, any, any> =
    node === undefined
      ? Hyperlink.Tag<Self>()(key, spec, tagOptions)
      : Hyperlink.Tag<Self>()(key, spec, { ...tagOptions, node });
  const stamped: HyperlinkTag<any, any, any> =
    success === undefined && error === undefined
      ? base
      : applyDaemonTagSchemas(base, { success, error });
  return withDaemonReadiness(stamped);
};

/** How a daemon is scheduled — read by the runtime to build the right impl. @internal */
type ScheduleMode =
  | { readonly _tag: "inline"; readonly windows: ReadonlyArray<ScheduleWindow> }
  | { readonly _tag: "reference"; readonly source: HyperlinkTag<unknown, ScheduleHyperlinkSpec> };

/** Runtime guard for a stamped {@link ScheduleMode} — its `_tag` discriminant. @internal */
const isScheduleMode = (value: unknown): value is ScheduleMode =>
  typeof value === "object" &&
  value !== null &&
  "_tag" in value &&
  (value._tag === "inline" || value._tag === "reference");

/** Read a daemon tag's {@link ScheduleMode}, if any (set by {@link schedule}). @internal */
const scheduleModeOf = (tag: unknown): ScheduleMode | undefined => {
  if ((typeof tag === "object" || typeof tag === "function") && tag !== null && scheduleModeSym in tag) {
    const value = tag[scheduleModeSym];
    return isScheduleMode(value) ? value : undefined;
  }
  return undefined;
};

/**
 * Graft path-keyed leaves onto a tag's flat spec and rebuild its RPC group in place, optionally
 * stamping combinator metadata. Reuses the tag's already-claimed `groupId` (no re-claim). Returns
 * the same (mutated) tag — so `class X extends Tag()(...).pipe(combinator) {}` extends it. @internal
 */
const augmentTag = (
  tag: HyperlinkTag<any, any, any>,
  flatAddition: FlatSpec,
  stamp: object,
): HyperlinkTag<any, any, any> => {
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
 * Attach a schedule to a daemon (pipeable). Two forms, distinguished by argument:
 *
 * - **inline windows** — the daemon **owns** an in-memory schedule seeded with `windows`, and its
 *   contract gains the `schedule` verb group (`entries` / `set` / `add` / `clear`):
 *
 * ```ts
 * class Matches extends Daemon.Tag<Matches>()("app/Matches").pipe(
 *   Daemon.schedule([Daemon.window(kickoff, final)]),
 * ) {}
 * ```
 *
 * - **an external {@link Schedule}** — the daemon is **gated by** a shared schedule resource and
 *   gains **no** schedule verbs (they live on the resource, which can arm many processes at once):
 *
 * ```ts
 * class IngestScores extends Daemon.Tag<IngestScores>()("app/IngestScores").pipe(
 *   Daemon.schedule(SeasonSchedule),
 * ) {}
 * ```
 *
 * @category schedule
 * @public
 */
export function schedule(
  windows: ReadonlyArray<ScheduleWindow>,
): <Self, S extends Spec>(tag: HyperlinkTag<Self, S>) => HyperlinkTag<any, S & ScheduleGroupSpec>;
export function schedule(
  source: HyperlinkTag<any, ScheduleHyperlinkSpec>,
): <Self, S extends Spec>(tag: HyperlinkTag<Self, S>) => HyperlinkTag<any, S>;
export function schedule(
  windowsOrSource: ReadonlyArray<ScheduleWindow> | HyperlinkTag<any, any, any>,
): (tag: HyperlinkTag<any, any, any>) => HyperlinkTag<any, any, any> {
  // A type-guard (not bare `Array.isArray`) so the else-branch narrows to the tag: `Array.isArray`
  // alone won't remove a `ReadonlyArray` from the union.
  const isWindows = (
    x: ReadonlyArray<ScheduleWindow> | HyperlinkTag<any, any, any>,
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

/**
 * Callable shape for {@link Tag} — overloads for positional schemas + config object.
 *
 * @category models
 * @public
 */
export type DaemonTagBuild<Self> = {
  (key: string): HyperlinkTag<Self, DaemonInstanceSpec>;
  <A extends Schema.Top>(
    key: string,
    success: A,
  ): HyperlinkTag<Self, DaemonInstanceSpec<A>>;
  <A extends Schema.Top, E extends Schema.Top>(
    key: string,
    success: A,
    error: E,
  ): HyperlinkTag<Self, DaemonInstanceSpec<A, E>>;
  <A extends Schema.Top>(
    key: string,
    options: DaemonTagOptions & { readonly success: A },
  ): HyperlinkTag<Self, DaemonInstanceSpec<A>>;
  <E extends Schema.Top>(
    key: string,
    options: DaemonTagOptions & { readonly error: E },
  ): HyperlinkTag<Self, DaemonInstanceSpec<typeof Schema.Void, E>>;
  <A extends Schema.Top, E extends Schema.Top>(
    key: string,
    options: DaemonTagOptions & { readonly success: A; readonly error: E },
  ): HyperlinkTag<Self, DaemonInstanceSpec<A, E>>;
  <HSelf>(
    key: string,
    options: DaemonTagOptions & { readonly node: NodeKey<HSelf> },
  ): NodeBoundTag<Self, DaemonInstanceSpec, HSelf>;
  <A extends Schema.Top, HSelf>(
    key: string,
    options: DaemonTagOptions & { readonly success: A; readonly node: NodeKey<HSelf> },
  ): NodeBoundTag<Self, DaemonInstanceSpec<A>, HSelf>;
  (key: string, options?: DaemonTagOptions): HyperlinkTag<Self, DaemonInstanceSpec>;
};

/**
 * Define a managed daemon as a toolkit resource. `Self` is given explicitly (Effect's `()`
 * two-stage form). The base tag carries observation + lifecycle; add a schedule with
 * `.pipe(`{@link schedule}`(…))`. Declare value/error wire schemas on the tag:
 *
 * ```ts
 * class Health extends Daemon.Tag<Health>()("app/Health") {}
 *
 * class Prices extends Daemon.Tag<Prices>()("app/Prices", PriceSchema) {}
 *
 * class PricesE extends Daemon.Tag<PricesE>()("app/Prices", PriceSchema, FetchErr) {}
 *
 * class PricesCfg extends Daemon.Tag<PricesCfg>()("app/Prices", {
 *   success: PriceSchema,
 *   error: FetchErr,
 * }) {}
 * ```
 *
 * Pass `options.node` to bind the daemon to a {@link Node.Tag}.
 *
 * @category constructors
 * @public
 */
export const Tag = <Self>() => {
  function build(
    key: string,
    second?: Schema.Top | DaemonTagOptions,
    third?: Schema.Top,
  ): HyperlinkTag<Self, DaemonSpec> | NodeBoundTag<Self, DaemonSpec, unknown> {
    if (second === undefined) {
      return buildDaemonTag<Self>(key, undefined);
    }
    if (Schema.isSchema(second)) {
      return buildDaemonTag<Self>(key, undefined, {
        success: second,
        error: third,
      });
    }
    if (isDaemonTagOptions(second)) {
      return buildDaemonTag<Self>(key, second);
    }
    return buildDaemonTag<Self>(key, undefined);
  }
  // The single, guarded cast: an overloaded *function* (`build`) isn't structurally assignable to a
  // call-signature *object* type (`DaemonTagBuild<Self>`) even when it implements exactly those
  // overloads — a known TS limitation (the same class as WorkPool's `nameQueueService` cast).
  // It's soundness-guarded: `daemon-driver` / `daemon-contract-shape` .test-d.ts exercise
  // `Daemon.Tag()` in every form, so a drift between `build` and `DaemonTagBuild` fails the build.
  return build as DaemonTagBuild<Self>;
};

/**
 * Define a standalone {@link Schedule} resource — a reusable, RPC-capable window manager one or more
 * daemons can be gated by (via `.pipe(`{@link schedule}`(ThisSchedule))`). Full CRUD; pass
 * `options.node` to bind it to a {@link Node.Tag}, like {@link Tag}.
 *
 * ```ts
 * class SeasonSchedule extends Daemon.Schedule<SeasonSchedule>()("app/SeasonSchedule") {}
 * const s = yield* SeasonSchedule;
 * yield* s.add({ id: "wk2", startAt: wk2Start, stopAt: wk2End }); // arms every gated daemon
 * ```
 *
 * @category schedule
 * @public
 */
export const Schedule = <Self>() => {
  function build<HSelf>(
    key: string,
    options: { readonly description?: string; readonly node: NodeKey<HSelf> },
  ): NodeBoundTag<Self, ScheduleHyperlinkSpec, HSelf>;
  function build(
    key: string,
    options?: { readonly description?: string },
  ): HyperlinkTag<Self, ScheduleHyperlinkSpec>;
  function build(
    key: string,
    options?: { readonly description?: string; readonly node?: NodeKey<unknown> },
  ): HyperlinkTag<Self, ScheduleHyperlinkSpec> {
    const node = options?.node;
    const tagOptions = { description: options?.description, kind: scheduleKind };
    return node === undefined
      ? Hyperlink.Tag<Self>()(key, scheduleHyperlinkSpec, tagOptions)
      : Hyperlink.Tag<Self>()(key, scheduleHyperlinkSpec, { ...tagOptions, node });
  }
  return build;
};

// ============================================================================
// Toolkit runtime — config
// ============================================================================

/**
 * Config for {@link layer} / {@link serve} / {@link serveRemote}. The `effect` is the work each run
 * performs; its success is captured into `result` when the tag is value-returning. Scheduling comes
 * from the **tag** now (`Daemon.schedule(...)`), not the config.
 *
 * @category models
 * @public
 */
export interface DaemonLayerConfig<A, E, R> {
  readonly effect: Effect.Effect<A, E, R>;
  /** Optional polling layer for in-instance repeat cadence. */
  readonly polling?: Layer.Layer<PollingTag, never, never>;
}

// ============================================================================
// wire ⇄ engine mapping
// ============================================================================

type WireEntry = typeof daemonScheduleEntry.Type;

const toWireEntry = (entry: DaemonScheduleEntry): WireEntry => ({
  ...(Option.isSome(entry.id) ? { id: entry.id.value } : {}),
  startAt: DateTime.makeUnsafe(entry.startAt.getTime()),
  ...(Option.isSome(entry.stopAt)
    ? { stopAt: DateTime.makeUnsafe(entry.stopAt.value.getTime()) }
    : {}),
});

const fromWireEntry = (wire: WireEntry): DaemonScheduleEntry => ({
  id: wire.id !== undefined ? Option.some(wire.id) : Option.none(),
  startAt: DateTime.toDateUtc(wire.startAt),
  stopAt:
    wire.stopAt !== undefined
      ? Option.some(DateTime.toDateUtc(wire.stopAt))
      : Option.none(),
});

const toWireStatus = (
  snap: DaemonSnapshot,
  supervising: boolean,
): typeof daemonStatus.Type => ({
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
  svc: DaemonScheduleService,
): Subscribable<ReadonlyArray<WireEntry>> => ({
  get: Effect.map(svc.entries, (entries) => entries.map(toWireEntry)),
  changes: Stream.concat(
    Stream.fromEffect(svc.entries),
    Stream.fromEffectRepeat(Effect.flatMap(svc.changed, () => svc.entries)),
  ).pipe(Stream.map((entries) => entries.map(toWireEntry))),
});

/** Thrown (as a defect) when a reference-mode daemon is materialized before its runtime lands. */
class ReferenceScheduleNotWired extends Data.TaggedError(
  "ReferenceScheduleNotWired",
)<{ readonly daemon: string }> {}

const statusPollInterval = Duration.millis(500);

const fromWindow = (w: ScheduleWindow): DaemonScheduleEntry => ({
  id: w.id,
  startAt: w.startAt,
  stopAt: w.stopAt,
});

// ============================================================================
// Daemon impl builder
// ============================================================================

/**
 * Build the live daemon driver behind `tag` and map it onto the toolkit service impl — the adapter
 * shared by {@link layer} / {@link serve} / {@link serveRemote}. The returned record is shaped to the
 * tag's composed spec (base, `+ schedule`, `+ result`); `Hyperlink.layer` flattens it against the
 * tag's flat spec, so extra members are simply present when the spec declares them.
 */
const buildDaemonImpl = <A, E, R>(
  tag: HyperlinkTag<any, any, any>,
  baseConfig: DaemonLayerConfig<A, E, R>,
): Effect.Effect<Hyperlink.Driver<DaemonSpec, R>, never, R | Scope.Scope | Store.Storage> =>
  Effect.gen(function* () {
    const context = yield* Effect.context<R>();
    const scope = yield* Effect.scope;

    const config = yield* foldConfiguredSpec<DaemonLayerConfig<A, E, R>>(tag.key, baseConfig);

    const mode = scheduleModeOf(tag);
    if (mode?._tag === "reference") {
      return yield* Effect.die(new ReferenceScheduleNotWired({ daemon: tag.key }));
    }

    // ── result capture (value-returning daemon) ──
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

    const tapLogs = <A2, E2, R2>(effect: Effect.Effect<A2, E2, R2>): Effect.Effect<A2, E2, R2> =>
      withLogScope(tag)(effect);

    // ── schedule: inline windows own an in-memory store; otherwise always-armed ──
    const baseScheduleLayer =
      mode?._tag === "inline"
        ? DaemonSchedule.inMemory(mode.windows.map(fromWindow))
        : DaemonSchedule.alwaysArmed;
    const scheduleCtx = yield* Layer.build(baseScheduleLayer);
    const scheduleSvc = Context.get(scheduleCtx, DaemonScheduleTag);

    // Fail-loud Soft: AppStore missing this engine registration dies at layer build
    // (not silent empty journals on first write). Soft-default Memory always materializes.
    yield* Store.resolveOrDie(tag.key, builtInDaemonStoreContract(tag));
    const storeEffects = pipe(
      Store.effects(tag.key, builtInDaemonStoreContract(tag)),
      Store.catchWriteErrors,
    );
    const storageContext = yield* Effect.context<Store.Storage>();
    const store: DaemonStoreWriter = Store.provideContext(storeEffects, storageContext);

    const handle = make(tag.key, {
      effect: captured,
      ...(config.polling !== undefined ? { polling: config.polling } : {}),
      scheduleLayer: Layer.succeedContext(scheduleCtx),
      _store: store,
      _storeScopeTag: tag,
      _resultRef: resultRef,
    });

    const fiberRef = yield* Ref.make<Fiber.Fiber<void, never> | null>(null);
    const start = Effect.gen(function* () {
      if ((yield* Ref.get(fiberRef)) !== null) return;
      const fiber = yield* Effect.forkIn(handle.effect.pipe(tapLogs), scope);
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
      resultRef !== undefined ? { result: Hyperlink.subscribable(resultRef) } : {};

    // Worker methods are built unwrapped (each still carrying `R`); `provideContext` discharges them.
    // Erased to the base `DaemonSpec` here (same as `run`) — stamped event schemas live on the tag wire.
    const impl = {
      status: { get: readStatus, changes: statusChanges },
      start,
      stop,
      wake: handle.polling.wake,
      resetCadence: handle.polling.resetCadence,
      events: handle.events,
      run: handle.run().pipe(tapLogs),
      ...scheduleMembers,
      ...resultMembers,
    };
    return Hyperlink.driver(
      tag,
      impl,
      context,
    );
  });

// ============================================================================
// Public layers
// ============================================================================

// The public layers are **overloaded**: the visible signature is generic over the tag's composed spec
// `S` (so a `+ schedule` / `+ result` tag is accepted and `Self` — the composed service — is granted),
// while the implementation signature is loose (`HyperlinkTag<any, any, any>` + a loose impl) so the
// dynamically-shaped `buildDaemonImpl` record fits. Two deliberate choices keep the types shallow:
//   1. the visible **return** names `HandlerContextOf<DaemonSpec>` (the concrete base), not
//      `HandlerContextOf<S>` — walking that over an open `S` blows the instantiation depth, and the
//      served handler set is a run-time concern anyway (see 2);
//   2. internally the tag is narrowed to the concrete base spec (`baseTag`) before `Hyperlink.serve`,
//      so its `HandlerContextOf`/`ImplOf` walks stay shallow.
// At run time `Hyperlink.serve` reads the tag's own `groupSym` / `specSym`, so the **full** handler set
// (incl. the grafted `schedule` / `result` verbs) is mounted even though the static `HandlerContextOf`
// names the base. `buildDaemonImpl` receives the original tag, so it still reads the composed metadata.

/**
 * Soft-default {@link Store.Storage} ({@link Store.withDefaultStorage}) — R fulfilled; override by
 * providing an app store into this layer. @internal
 */
const withDefaultMemory = <A, E, R>(
  layer: Layer.Layer<A, E, R | Store.Storage>,
): Layer.Layer<A | Store.Storage, E, R> => Store.withDefaultStorage(layer);

/**
 * The **local** layer for a daemon: build its driver (auto-started) and provide its service.
 *
 * Soft-defaults an in-memory {@link Store.Storage} (R fulfilled). Override with your app store:
 *
 * ```ts
 * Daemon.layer(Tag, config).pipe(Layer.provideMerge(AppStore.layer({ filename })))
 * ```
 *
 * {@link layerMemory} is an alias for the same soft-default.
 *
 * @category layers & serving
 * @public
 */
export function layer<Self, S extends Spec, A = void, E = never, R = never>(
  tag: HyperlinkTag<Self, S>,
  config: DaemonLayerConfig<A, E, R>,
): Layer.Layer<Self | Local<Self> | Store.Storage, never, R>;
export function layer(
  tag: HyperlinkTag<any, any, any>,
  config: DaemonLayerConfig<any, any, any>,
): Layer.Layer<any, any, any> {
  const baseTag: HyperlinkTag<any, DaemonSpec> = tag;
  return withDefaultMemory(
    Layer.unwrap(
      Effect.map(buildDaemonImpl(tag, config), (built) =>
        Hyperlink.layer(baseTag, Hyperlink.grantLocal(baseTag, built)),
      ),
    ) as any,
  ) as any;
}

/**
 * Alias of {@link layer} — soft-default in-memory Storage (override the same way).
 *
 * @category layers & serving
 * @public
 */
export function layerMemory<Self, S extends Spec, A = void, E = never, R = never>(
  tag: HyperlinkTag<Self, S>,
  config: DaemonLayerConfig<A, E, R>,
): Layer.Layer<Self | Local<Self> | Store.Storage, never, R>;
export function layerMemory(
  tag: HyperlinkTag<any, any, any>,
  config: DaemonLayerConfig<any, any, any>,
): Layer.Layer<any, any, any> {
  return layer(tag, config) as any;
}

/**
 * Serve a daemon **and** grant its local instance from one materialization.
 *
 * Soft-defaults {@link Store.Storage}. Override with `Layer.provide` / `provideMerge(AppStore)`.
 *
 * @category layers & serving
 * @public
 */
export function serve<Self, S extends Spec, A = void, E = never, R = never>(
  tag: HyperlinkTag<Self, S>,
  config: DaemonLayerConfig<A, E, R>,
): Layer.Layer<
  Self | Local<Self> | HandlerContextOf<DaemonSpec> | Store.Storage,
  never,
  R
>;
export function serve(
  tag: HyperlinkTag<any, any, any>,
  config: DaemonLayerConfig<any, any, any>,
): Layer.Layer<any, any, any> {
  const baseTag: HyperlinkTag<any, DaemonSpec> = tag;
  return withDefaultMemory(
    Layer.unwrap(
      Effect.map(
        buildDaemonImpl(tag, config),
        (built) => Hyperlink.serve(baseTag, built) as any,
      ),
    ) as any,
  ) as any;
}

/**
 * Alias of {@link serve}.
 *
 * @category layers & serving
 * @public
 */
export function serveMemory<Self, S extends Spec, A = void, E = never, R = never>(
  tag: HyperlinkTag<Self, S>,
  config: DaemonLayerConfig<A, E, R>,
): Layer.Layer<
  Self | Local<Self> | HandlerContextOf<DaemonSpec> | Store.Storage,
  never,
  R
>;
export function serveMemory(
  tag: HyperlinkTag<any, any, any>,
  config: DaemonLayerConfig<any, any, any>,
): Layer.Layer<any, any, any> {
  return serve(tag, config) as any;
}

/**
 * Serve a daemon **remotely (served-only)** — mounts its RPC handlers without granting the local
 * instance, preserving the requirement `R` for a per-resource `Layer.provide`.
 *
 * Soft-defaults {@link Store.Storage}. Override with `Layer.provide` / `provideMerge(AppStore)`.
 *
 * @category layers & serving
 * @public
 */
export function serveRemote<Self, S extends Spec, A = void, E = never, R = never>(
  tag: HyperlinkTag<Self, S>,
  config: DaemonLayerConfig<A, E, R>,
): Layer.Layer<HandlerContextOf<DaemonSpec> | Store.Storage, never, R>;
export function serveRemote(
  tag: HyperlinkTag<any, any, any>,
  config: DaemonLayerConfig<any, any, any>,
): Layer.Layer<any, any, any> {
  const baseTag: HyperlinkTag<any, DaemonSpec> = tag;
  return withDefaultMemory(
    Layer.unwrap(
      Effect.map(
        buildDaemonImpl(tag, config),
        (built) => Hyperlink.serveRemote(baseTag, built) as any,
      ),
    ) as any,
  ) as any;
}

/**
 * Alias of {@link serveRemote}.
 *
 * @category layers & serving
 * @public
 */
export function serveRemoteMemory<Self, S extends Spec, A = void, E = never, R = never>(
  tag: HyperlinkTag<Self, S>,
  config: DaemonLayerConfig<A, E, R>,
): Layer.Layer<HandlerContextOf<DaemonSpec> | Store.Storage, never, R>;
export function serveRemoteMemory(
  tag: HyperlinkTag<any, any, any>,
  config: DaemonLayerConfig<any, any, any>,
): Layer.Layer<any, any, any> {
  return serveRemote(tag, config) as any;
}

/**
 * A **config-patch layer** for the daemon `tag` — merge it with the daemon's {@link layer} and its
 * patch (polling / a `(previous) => next` wrap of `effect`) folds onto the base config at build.
 *
 * @category layers & serving
 * @public
 */
export const configure = <A = void, E = never, R = never>(
  tag: HyperlinkTag<any, any, any>,
  patch: ConfigPatch<DaemonLayerConfig<A, E, R>>,
): Layer.Layer<never> => configureLayer(tag.key, patch);

/**
 * Register this daemon on an app {@link Store.Service} — built-in execution analytics with an
 * optional bare spec object merged in:
 *
 * ```ts
 * Daemon.store(Daily)
 * Daemon.store(Daily, {
 *   audit: auditSchema,
 * }, ({ audit, event }) => ({
 *   appendAudit: audit.append,
 * }))
 * ```
 *
 * @category layers & serving
 * @public
 */
export function store<const Tag extends StoreScopeTag>(tag: Tag): ReturnType<
  typeof facetStoreRegistration<Tag, DaemonStoreAnalyticsContract<Tag>>
>;
export function store<
  const Tag extends StoreScopeTag,
  const Shapes extends StoreShapes,
>(tag: Tag, extended: Shapes): ReturnType<
  typeof facetStoreRegistration<
    Tag,
    DaemonStoreAnalyticsContract<Tag>,
    Shapes
  >
>;
export function store(tag: StoreScopeTag, extended?: StoreShapes) {
  const builtIn = makeDaemonStoreAnalyticsContract(tag);
  return extended === undefined
    ? facetStoreRegistration(tag, builtIn)
    : facetStoreRegistration(tag, builtIn, extended);
}

// ============================================================================
// Standalone Schedule resource layer
// ============================================================================

const buildScheduleImpl = (
  options?: { readonly initial?: ReadonlyArray<ScheduleWindow> },
): Effect.Effect<ImplOf<ScheduleHyperlinkSpec>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const ctx = yield* Layer.build(
      DaemonSchedule.inMemory((options?.initial ?? []).map(fromWindow)),
    );
    const scheduleSvc = Context.get(ctx, DaemonScheduleTag);
    const impl: ImplOf<ScheduleHyperlinkSpec> = {
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
 * @category schedule
 * @public
 */
export const scheduleLayer = <Self>(
  tag: HyperlinkTag<Self, ScheduleHyperlinkSpec>,
  options?: { readonly initial?: ReadonlyArray<ScheduleWindow> },
): Layer.Layer<Self | Local<Self>> =>
  Layer.unwrap(
    Effect.map(buildScheduleImpl(options), (impl) => Hyperlink.layer(tag, impl)),
  );

/**
 * Serve a standalone {@link Schedule} resource **and** grant its local instance.
 *
 * @category schedule
 * @public
 */
export const scheduleServe = <Self>(
  tag: HyperlinkTag<Self, ScheduleHyperlinkSpec>,
  options?: { readonly initial?: ReadonlyArray<ScheduleWindow> },
): Layer.Layer<Self | Local<Self> | HandlerContextOf<ScheduleHyperlinkSpec>> =>
  Layer.unwrap(
    Effect.map(buildScheduleImpl(options), (impl) => Hyperlink.serve(tag, impl)),
  );

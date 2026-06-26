/**
 * **Process contract (control surface)** — the fixed-schema service of a managed
 * {@link Process} expressed as a {@link Resource} {@link Spec}, so a long-running process
 * can be driven **remotely** over RPC through the toolkit's location-transparent layers
 * (the same `yield* Tag` code runs local or remote; only the provided layer changes).
 *
 * @remarks
 * This is the **first slice** of porting `Process` onto the toolkit — the control /
 * observation verbs, all of which have fixed schemas (a process has no per-instance item
 * type, so unlike `QueueResource` every process shares one spec; it binds to a plain
 * {@link Resource.Tag}, not a per-item spec).
 *
 * The surface mirrors the engine's two observable/controllable seams:
 * - **`ProcessMirror`** (armed / active instances / next trigger / next schedule transition /
 *   next poll cadence) → the {@link processStatus} snapshot, exposed as `statusNow` (one-shot)
 *   and `status` (live stream).
 * - **`ProcessScheduleControls`** (entries / set / add / clear) → `schedule` (read) plus the
 *   `setSchedule` / `addSchedule` / `clearSchedule` mutations.
 *
 * Plus lifecycle (`start` / `stop` / `runImmediately`) and the captured `logs` stream (same
 * structured log schema the queue uses). Note there is **no** `arm`/`disarm` verb: `armed` is
 * **derived** from the schedule (a process is armed iff an entry currently places it in a run
 * window), so arming is done by mutating the schedule, not a manual toggle.
 *
 * The engine **control handle** these verbs forward to, and the `Tag` / `layer` / `server` /
 * `serveHttp` wiring, land in the next slice (they require exposing a controllable handle from
 * the `Process` supervisor — today the handle is only `{ effect, runImmediately }`).
 *
 * @module ProcessContract
 */
import {
  Context,
  DateTime,
  Duration,
  Effect,
  Fiber,
  Layer,
  Option,
  Ref,
  Schema,
  Stream,
} from "effect";
import { Resource, hostSym } from "./Resource";
import type {
  HandlerContextOf,
  HostKey,
  LocalCapability,
  ResourceTag,
  ServiceOf,
} from "./Resource";
import { Process } from "./Process";
import type {
  ProcessMakeOptions,
  ProcessScheduleLayerInput,
  ProcessSnapshot,
} from "./Process";
import { ProcessSchedule } from "./ProcessSchedule";
import type { ProcessScheduleEntry } from "./ProcessSchedule";
import { ProcessManagerLogEntrySchema } from "./LogEntry";
import { configureLayer, foldConfiguredSpec } from "./ResourceConfigure";
import type { ConfigPatch } from "./ResourceConfigure";

/**
 * A captured log line on the wire — the element of a process's `logs` stream. Reuses the
 * package's structured log schema ({@link ProcessManagerLogEntrySchema}: `date`, `level`,
 * `message`, `cause?`, `annotations`, `spans`), so every datapoint and the level are preserved
 * across RPC. (Re-exported under a process-neutral name.)
 *
 * @public
 */
export const processLogEntry = ProcessManagerLogEntrySchema;

/**
 * One scheduled run window on the wire — the wire form of the engine's `ProcessScheduleEntry`.
 * The engine models `id` / `stopAt` as `Option` and the times as `Date`; the toolkit standard
 * is `DateTime.Utc` and `optionalKey`, so the impl maps between them. `startAt` is when the run
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
 * The current-state snapshot of a managed process — the engine's `ProcessMirror`. Element of
 * the `status` stream and the result of `statusNow`.
 *
 * - `supervising` — whether the trigger driver is currently running (toggled by `start`/`stop`).
 * - `armed` — whether the schedule currently has the process armed to trigger (derived from the
 *   schedule entries; independent of `supervising`).
 * - `activeInstances` — how many run instances are executing right now.
 * - `nextTriggerRun` — when the next run instance is expected to start (absent if disarmed/idle).
 * - `nextScheduleTransition` — when the schedule next changes armed/disarmed (absent if none).
 * - `nextPollCadence` — the in-instance repeat cadence, when polling is configured.
 * - `runsStarted` / `runsSucceeded` / `runsFailed` — cumulative run counts since the layer built
 *   (counted at the single run boundary, so they cover scheduled + polling + `runImmediately`).
 * - `lastRunStartedAt` / `lastRunDurationMillis` — when the most recent run began and how long the
 *   most recent finished run took (ms).
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
  // run metrics (cumulative since the layer built) — counts + most-recent-run timing
  runsStarted: Schema.Number,
  runsSucceeded: Schema.Number,
  runsFailed: Schema.Number,
  lastRunStartedAt: Schema.optionalKey(Schema.DateTimeUtc),
  lastRunDurationMillis: Schema.optionalKey(Schema.Number),
});

/**
 * The process **control + observation** contract: the fixed-schema verbs of a managed process,
 * shared by every process instance. Mirrors the controllable/observable members the engine
 * supervisor exposes (`ProcessMirror` + `ProcessScheduleControls` + lifecycle).
 *
 * @public
 */
export const processControlSpec = {
  // ─── Observation ───
  statusNow: Resource.query(processStatus).annotate({
    description:
      "One-shot current-state snapshot (armed, active instances, next trigger/transition, " +
      "poll cadence) — the `status` stream's element read once.",
  }),
  status: Resource.stream(processStatus).annotate({
    description:
      "Live current-state snapshot — emits the current process state and every change.",
  }),
  schedule: Resource.query(Schema.Array(processScheduleEntry)).annotate({
    description: "The process's current schedule entries (run windows), sorted by startAt.",
  }),
  logs: Resource.stream(processLogEntry).annotate({
    description:
      "Captured log lines (engine + instance effect) with level/annotations/spans — empty " +
      "unless the process was configured to capture logs.",
  }),

  // ─── Lifecycle ───
  start: Resource.mutate(Schema.Void).annotate({
    description: "Begin supervising — fork the trigger driver (idempotent).",
  }),
  stop: Resource.mutate(Schema.Void).annotate({
    description: "Stop supervising — interrupt the driver and any active run instances.",
    destructive: true,
  }),
  runImmediately: Resource.mutate(Schema.Void).annotate({
    description:
      "Run the process effect once with tracking, out of band — independent of the trigger cadence.",
  }),

  // ─── Schedule mutation (this is how you arm/disarm: armed is derived from entries) ───
  setSchedule: Resource.mutate(Schema.Void, {
    payload: Schema.Array(processScheduleEntry),
  }).annotate({
    description: "Replace all schedule entries.",
  }),
  addSchedule: Resource.mutate(Schema.Void, {
    payload: processScheduleEntry,
  }).annotate({
    description: "Append one schedule entry.",
  }),
  clearSchedule: Resource.mutate(Schema.Void).annotate({
    description: "Remove all schedule entries (disarms until new entries are added).",
    destructive: true,
  }),
};
// Note: no `satisfies Spec` — that would contextually widen each method's error channel to
// `unknown`. The spec is validated (without widening) at the `Resource.Tag` call site.

/** The (shared, fixed) spec every process instance is built from. */
type ProcessSpec = typeof processControlSpec;

/**
 * Define a managed process as a toolkit resource:
 *
 * ```ts
 * class Fetcher extends ProcessResource.Tag<Fetcher>()("@app/Fetcher") {}
 * const p = yield* Fetcher;
 * yield* p.runImmediately;
 * const s = yield* p.statusNow;
 * ```
 *
 * Unlike the queue, a process has no per-instance item type — every process shares the one
 * {@link processControlSpec}, so this binds a plain {@link Resource.Tag}. `Self` is given
 * explicitly (Effect's `()` two-stage form). Pass `options.host` to bind the process to a
 * {@link Resource.Host} (ship only the tag; see {@link Resource.client} / {@link Resource.connect}).
 *
 * @public
 */
export const processTag = <Self>() => {
  function build<HSelf>(
    id: string,
    options: { readonly description?: string; readonly host: HostKey<HSelf> },
  ): ResourceTag<Self, ProcessSpec> & { readonly [hostSym]: HostKey<HSelf> };
  function build(
    id: string,
    options?: { readonly description?: string },
  ): ResourceTag<Self, ProcessSpec>;
  function build(
    id: string,
    options?: { readonly description?: string; readonly host?: HostKey<unknown> },
  ): ResourceTag<Self, ProcessSpec> {
    const host = options?.host;
    return host === undefined
      ? Resource.Tag<Self>(id, options)(processControlSpec)
      : Resource.Tag<Self>(id, options)(processControlSpec, host);
  }
  return build;
};

/**
 * The config for {@link ProcessResource.layer} — the same options as {@link Process.make}
 * (`effect` plus optional `polling` / `schedule` / `scheduleLayer`). The tag carries the id.
 *
 * @public
 */
export type ProcessLayerConfig<E, R> = ProcessMakeOptions<E, R>;

// How often the `status` stream re-reads the snapshot. The mirror is a set of MutableRefs (no
// native subscription), so the live stream polls it; `statusNow` is the same read, on demand.
const statusPollInterval = Duration.millis(500);

// ─── wire ⇄ engine mapping (the contract uses DateTime.Utc + optionalKey; the engine uses Date + Option) ───

/**
 * Map a (native) engine schedule entry to its wire form. Shared with the standalone
 * {@link ProcessScheduleContract}. @internal
 */
export const toWireScheduleEntry = (
  entry: ProcessScheduleEntry,
): typeof processScheduleEntry.Type => ({
  ...(Option.isSome(entry.id) ? { id: entry.id.value } : {}),
  startAt: DateTime.makeUnsafe(entry.startAt.getTime()),
  ...(Option.isSome(entry.stopAt)
    ? { stopAt: DateTime.makeUnsafe(entry.stopAt.value.getTime()) }
    : {}),
});

/**
 * Map a wire schedule entry back to the engine's (native) form. Shared with the standalone
 * {@link ProcessScheduleContract}. @internal
 */
export const fromWireScheduleEntry = (
  wire: typeof processScheduleEntry.Type,
): ProcessScheduleEntry => ({
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

/**
 * Build the live {@link Process} driver behind `tag` and map it onto the toolkit service impl —
 * the single adapter shared by the **local** layer ({@link layer}) and the **remote** server
 * ({@link server} / {@link serveHttp}).
 *
 * The schedule is **hoisted**: it's built once here (into the layer scope) and fed back to the
 * driver as `Layer.succeedContext`, so the buried `provideStepLayers` and the contract's
 * `schedule` / `setSchedule` / `addSchedule` / `clearSchedule` verbs all share one mutable
 * `ProcessSchedule` instance. The default (no `schedule`/`scheduleLayer` in config) is an
 * in-memory store so the schedule verbs are usable. The driver is forked into the scope on build
 * (auto-start); `start` / `stop` re-fork / interrupt it. The worker `R` is captured at build time
 * and provided to each method, so the impl requires nothing beyond the scope.
 */
const buildProcessImpl = <Self, E, R>(
  tag: ResourceTag<Self, ProcessSpec>,
  baseConfig: ProcessLayerConfig<E, R>,
) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<R>();
    // The layer scope — `start` forks the driver into it (not a scope required at call time), so
    // the fiber lives with the layer and `start` itself carries no `Scope` requirement.
    const scope = yield* Effect.scope;
    const provideR = <Out, Err>(
      effect: Effect.Effect<Out, Err, R>,
    ): Effect.Effect<Out, Err> => Effect.provide(effect, context);

    // Fold any `.configure` patches in context (keyed by the tag id) onto the base config.
    const config = yield* foldConfiguredSpec<ProcessLayerConfig<E, R>>(
      tag.id,
      baseConfig,
    );

    // A schedule initializer stays an initializer; a schedule *layer* (or the default in-memory
    // store) is what we pre-build and share.
    const scheduleInitializer =
      typeof config.schedule === "function" ? config.schedule : undefined;
    // Default to alwaysArmed (mutable in-memory, pre-seeded with an always-open window) so a
    // process *runs immediately* with its layer — matching the engine default and the
    // "starts immediately unless disabled" rule. Pass `schedule: ProcessSchedule.empty` (or
    // specific windows) to start disarmed; the store stays mutable for setSchedule either way.
    const baseScheduleLayer: ProcessScheduleLayerInput =
      config.scheduleLayer ??
      (config.schedule !== undefined && typeof config.schedule !== "function"
        ? config.schedule
        : ProcessSchedule.alwaysArmed);
    const scheduleCtx = yield* Layer.build(baseScheduleLayer);
    const schedule = Context.get(scheduleCtx, ProcessSchedule);

    const handle = Process.make(tag.id, {
      effect: config.effect,
      ...(config.polling !== undefined ? { polling: config.polling } : {}),
      ...(scheduleInitializer !== undefined ? { schedule: scheduleInitializer } : {}),
      scheduleLayer: Layer.succeedContext(scheduleCtx),
    });

    const fiberRef = yield* Ref.make<Fiber.Fiber<void, never> | null>(null);

    const start = Effect.gen(function* () {
      if ((yield* Ref.get(fiberRef)) !== null) return;
      const fiber = yield* Effect.forkIn(provideR(handle.effect), scope);
      yield* Ref.set(fiberRef, fiber);
    });
    const stop = Effect.gen(function* () {
      const fiber = yield* Ref.get(fiberRef);
      if (fiber === null) return;
      yield* Fiber.interrupt(fiber);
      yield* Ref.set(fiberRef, null);
    });

    const statusNow = Effect.gen(function* () {
      const supervising = (yield* Ref.get(fiberRef)) !== null;
      return toWireStatus(yield* handle.snapshot, supervising);
    });

    yield* start; // auto-start the driver on build

    const impl: ServiceOf<ProcessSpec, Self> = {
      statusNow,
      status: Stream.tick(statusPollInterval).pipe(Stream.mapEffect(() => statusNow)),
      schedule: Effect.map(schedule.entries, (entries) => entries.map(toWireScheduleEntry)),
      logs: Stream.empty,
      start,
      stop,
      runImmediately: provideR(handle.runImmediately()),
      setSchedule: (entries) => schedule.set(entries.map(fromWireScheduleEntry)),
      addSchedule: (entry) => schedule.add(fromWireScheduleEntry(entry)),
      clearSchedule: schedule.clear,
    };
    return impl;
  });

export const layer = <Self, E = never, R = never>(
  tag: ResourceTag<Self, ProcessSpec>,
  config: ProcessLayerConfig<E, R>,
): Layer.Layer<Self | LocalCapability<Self>, never, R> =>
  Layer.unwrap(
    Effect.map(buildProcessImpl(tag, config), (impl) => Resource.layer(tag, impl)),
  );

/**
 * Expose a toolkit process **over RPC** (transport-agnostic): run the live driver behind the
 * tag and mount its handlers on the contract group. Compose with an `RpcServer` + a `Protocol`
 * layer to serve; or use {@link serveHttp} for the http batteries. A remote
 * {@link Resource.client} then drives the process with the identical `yield* Tag` surface.
 *
 * @public
 */
export const server = <Self, E = never, R = never>(
  tag: ResourceTag<Self, ProcessSpec>,
  config: ProcessLayerConfig<E, R>,
): Layer.Layer<HandlerContextOf<ProcessSpec>, never, R> =>
  Layer.unwrap(
    Effect.map(buildProcessImpl(tag, config), (impl) => Resource.server(tag, impl)),
  );

/**
 * Serve a toolkit process **over http** in one call — the driver wired behind the tag and
 * mounted on an http `RpcServer` (ndjson by default). Provide an `HttpServer` and you have a
 * remote process; a {@link Resource.client} + transport drives it as if local.
 *
 * @public
 */
export const serveHttp = <Self, E = never, R = never>(
  tag: ResourceTag<Self, ProcessSpec>,
  config: ProcessLayerConfig<E, R>,
  options?: Parameters<typeof Resource.serveHttp>[2],
) =>
  Layer.unwrap(
    Effect.map(buildProcessImpl(tag, config), (impl) =>
      Resource.serveHttp(tag, impl, options),
    ),
  );

/**
 * Process resource toolkit — managed long-running processes on the {@link Resource} toolkit.
 * `layer` runs it locally; `server` / `serveHttp` host it remotely; a remote
 * {@link Resource.client} drives it with the same `yield* Tag` surface.
 *
 * @public
 */
/**
 * A **config-patch layer** for the process `tag` — the toolkit successor to
 * `Process.Service(...).configure(...)`. Merge it with the process's {@link layer} (e.g. per
 * environment) and its patch (polling / schedule / a `(previous) => next` wrap of `effect`) folds
 * onto the layer's base config at build. Keyed by `tag.id`; later patches win. Config lives in the
 * layer, not the tag, so `configure` takes the tag and returns a layer.
 *
 * @public
 */
export const configure = <Self, E = never, R = never>(
  tag: ResourceTag<Self, ProcessSpec>,
  patch: ConfigPatch<ProcessLayerConfig<E, R>>,
): Layer.Layer<never> => configureLayer(tag.id, patch);

// The unified `ProcessResource` namespace is assembled in `internal/processResourceNamespace.ts`
// and re-exported by the barrel as `export * as ProcessResource` (so member access tree-shakes:
// the light `Tag`/spec never pulls the engine that `layer`/`server`/`serveHttp` use).
//
// DX: `import * as ProcessResource from "@nikscripts/effect-pm/ProcessContract"` gives a
// tree-shakeable namespace — `ProcessResource.Tag` (alias of `processTag`) pulls no engine code.
export { processTag as Tag };

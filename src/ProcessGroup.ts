/**
 * ProcessGroup — thin orchestrator for processes and queues.
 *
 * Owns process supervisor fibers (via `FiberMap`) and queue references.
 * Status is derived from fiber liveness — no redundant state tracking.
 *
 * ## Usage
 *
 * ```ts
 * const group = yield* ProcessGroup.make({
 *   processes: [emailSync, dataPoller],
 *   queues: [EmailQueue, NotificationQueue],
 * })
 *
 * yield* group.startAll() // forks deferred queue workers (`autoStart: false`), then starts processes
 * yield* group.status
 * yield* ProcessGroup.awaitShutdown(group)
 * ```
 *
 * @module ProcessGroup
 */

import { Cause, Clock, Context, Data, DateTime, Duration, Effect, FiberMap, Layer, Option, Ref, Schema, Scope } from "effect";
import type { HttpClient } from "effect/unstable/http";
import type { Process, ProcessDefinition, ProcessServiceDefinition } from "./Process";
import type {
  QueueHandle,
  QueueItemCodecDescriptor,
  QueueResourceDefinition,
  QueueResourceServiceDefinition,
} from "./QueueResource";
import type { ProcessManagerGroupConfigItem, RemoteProcessManager } from "./ProcessManager";
import {
  QueueBatchValidationError,
  QueueItemCodecDescriptorSchema,
  QueueItemValidationError,
} from "./QueueResource";
import { layerProcessGroupLogContext } from "./processManagerLogContext.js";
import {
  ProcessStore,
  type ProcessLifecycleChangedEvent,
} from "./ProcessStore";

// ============================================================================
// Public Types
// ============================================================================

/** @internal Dependency slot needed to obtain each manually supplied queue tag (see Context key `Identifier`). */
type TagIdentifier<T> = Extract<
  T,
  Context.Key<any, QueueHandle<any, any, any, any>>
> extends never
  ? never
  : Extract<T, Context.Key<any, QueueHandle<any, any, any, any>>>["Identifier"];

/** @internal Queue tags consumed by {@link makeProcessGroup} at fork time. */
type ProcessGroupQueueTag = Context.Key<any, QueueHandle<any, any, any, any>>;

/**
 * Service identifiers referenced by typed queue registrations in {@link Entries}.
 *
 * @remarks
 * Entries use structurally narrowed `id` / `key` fields (see {@link ProcessGroupQueueRegistration})
 * so this type stays grounded in **string literal** identifiers even though the underlying
 * `Context.Service` brands use invariant class/`Self` types at runtime.
 *
 * @public
 */
/**
 * Extract the service requirements from a Process handle.
 * @public
 */
export type ProcessEffectRequirements<P> = P extends Process<infer R> ? R : never;

/**
 * Union of requirements for all processes in a tuple.
 * @public
 */
// NB: `Process<any>` here (and below) is a type-inference upper bound, not an
// unsafe `any`. `Process<R>` exposes `R` in contravariant position via its
// `effect`/`runImmediately` fields, so `Process<unknown>` is not a true
// supertype; replacing this with `unknown` breaks tuple-element narrowing
// during iteration. The downstream `ProcessEffectRequirements` reads `R` back
// out via `infer`, so callers still get precise typed requirements.
export type AllGroupProcessesRequirements<
  Processes extends readonly Process<any>[],
> = ProcessEffectRequirements<Processes[number]>;

/**
 * Structural queue metadata carried on typed {@link ProcessGroup} entry tuples.
 *
 * @remarks
 * Runtime values are Context tags (`QueueResource.Service` / `.Tag`). This shape
 * purposefully avoids inheriting invariant `Context.Service` positions so tuples
 * keep **literal `id` / `key`** for dependency typing; bridging into
 * {@link makeProcessGroup} uses `unknown` widening at {@link makeTypedProcessGroup}.
 *
 * @public
 */
export interface ProcessGroupQueueRegistration<out Id extends string = string> {
  readonly kind: "queue";
  readonly id: Id;
  readonly key: Id;
  readonly item?: QueueItemCodecDescriptor;
  /** Present on `QueueResource.Service` factories; merges into {@link ProcessGroup.Service} when set. */
  readonly layer?: Layer.Layer<never, never, unknown>;
}

export type ProcessGroupEntry =
  | ProcessDefinition<string, any>
  | ProcessServiceDefinition<any, string, any>
  | ProcessGroupQueueRegistration
  | QueueResourceServiceDefinition<any, string, any, any, any, any>;

/**
 * Process entries from a typed ProcessGroup entry tuple.
 *
 * @public
 */
export type ProcessGroupProcessEntries<
  Entries extends readonly ProcessGroupEntry[],
> = Extract<Entries[number], { readonly kind: "process" }>;

/**
 * Queue entries from a typed ProcessGroup entry tuple.
 *
 * @public
 */
export type ProcessGroupQueueEntries<
  Entries extends readonly ProcessGroupEntry[],
> = Extract<Entries[number], { readonly kind: "queue" }>;

/**
 * Queue slots required to run a typed {@link ProcessGroup.make} / {@link ProcessGroup.Service}
 * built from {@link Entries}.
 *
 * @remarks
 * For {@link QueueResource.Service} declarations, resolves to the **tag class** (`Self`)
 * so {@link Effect.provide} with {@link QueueResourceServiceDefinition.layer} subtracts
 * the same dependencies as {@link yield* EmailQueue}. Plain structural
 * {@link ProcessGroupQueueRegistration} values use their string `id` literals.
 *
 * @public
 */
type TypedProcessGroupQueueRequirementForEntry<Entry> =
  Entry extends { readonly tag: Context.Key<infer Self, QueueHandle<any, any, any, any>> }
    ? Self
    : Entry extends ProcessGroupQueueRegistration<infer Id>
      ? Id
      : never;

/**
 * Queue slots required to run a typed {@link ProcessGroup.make} / {@link ProcessGroup.Service}
 * built from {@link Entries}.
 *
 * @remarks
 * For {@link QueueResource.Service} declarations, resolves to the **tag class** (`Self`)
 * so {@link Effect.provide} with {@link QueueResourceServiceDefinition.layer} subtracts
 * the same dependencies as {@link yield* EmailQueue}. Plain structural
 * {@link ProcessGroupQueueRegistration} values use their string `id` literals.
 *
 * @public
 */
export type TypedProcessGroupQueueRequirements<
  Entries extends readonly ProcessGroupEntry[],
> = {
  [K in keyof Entries]: TypedProcessGroupQueueRequirementForEntry<Entries[K]>;
}[Extract<keyof Entries, number>];

/**
 * Dependencies for constructing {@link ProcessGroup.Service.layer}: scoped group
 * build (`Scope.Scope`) plus any queue identifiers the layer may still expose in
 * the requirement channel alongside bundled queue Layers.
 *
 * @internal
 */
type ProcessGroupServiceLayerRequirements<Entries extends readonly ProcessGroupEntry[]> =
  TypedProcessGroupQueueRequirements<Entries> extends never
    ? Scope.Scope
    : TypedProcessGroupQueueRequirements<Entries> | Scope.Scope;

/**
 * Requirement channel carried by bundled queue Layers merged into {@link ProcessGroup.Service}.
 *
 * @internal
 */
type ProcessGroupBundledQueueLayerContext<Entries extends readonly ProcessGroupEntry[]> =
  Entries[number] extends infer E
    ? E extends QueueResourceServiceDefinition<any, string, any, any, any, infer R>
      ? R
      : E extends ProcessGroupQueueRegistration & { readonly layer: Layer.Layer<any, never, infer R> }
        ? R
        : never
    : never;

/** @internal */
type ProcessGroupServiceLayerProvided<Entries extends readonly ProcessGroupEntry[]> =
  ProcessGroupServiceLayerRequirements<Entries> | ProcessGroupBundledQueueLayerContext<Entries>;

const emptyProcessGroupConfigItems: readonly [] = [];

/**
 * Combined process requirements for a typed ProcessGroup entry tuple.
 *
 * @public
 */
type ProcessRequirementsFromEntry<Entry> = Entry extends ProcessDefinition<string, infer R>
  ? R
  : Entry extends ProcessServiceDefinition<any, string, infer R>
    ? R
    : never;

export type ProcessGroupEntryRequirements<
  Entries extends readonly ProcessGroupEntry[],
> = ProcessRequirementsFromEntry<ProcessGroupProcessEntries<Entries>>;

/**
 * Queue item type for a queue entry.
 *
 * @public
 */
export type ProcessGroupQueueItem<Queue> =
  Queue extends QueueResourceServiceDefinition<any, string, infer T, any, any, any>
    ? T
    : Queue extends Context.ServiceClass<any, string, QueueHandle<infer T, any, any, any>>
      ? T
    : Queue extends { readonly Service: QueueHandle<infer T, any, any, any> }
      ? T
      : Queue extends QueueResourceDefinition<string, infer T, any, any, any>
        ? T
        : never;

/**
 * Runtime schema for process controls exposed by a group contract.
 *
 * @public
 */
export const ProcessGroupProcessControlSchema = Schema.Literals([
  "start",
  "stop",
  "restart",
  "runImmediately",
  "status",
] as const);

/**
 * Process controls that can be exposed locally or over a remote group contract.
 *
 * @public
 */
export type ProcessGroupProcessControl =
  typeof ProcessGroupProcessControlSchema.Type;

/**
 * Runtime schema for queue controls exposed by a group contract.
 *
 * @public
 */
export const ProcessGroupQueueControlSchema = Schema.Literals([
  "enqueue",
  "release",
  "start",
  "pause",
  "resume",
  "clear",
  "status",
] as const);

/**
 * Queue controls included in a group contract.
 *
 * @remarks
 * `enqueue` is part of the serializable capability model, but
 * `ProcessGroup.remoteLayer` rejects remote enqueue-style methods until queues
 * expose schema-backed item contracts.
 *
 * @public
 */
export type ProcessGroupQueueControl =
  typeof ProcessGroupQueueControlSchema.Type;

/**
 * Runtime schema for process capability records in a group contract.
 *
 * @public
 */
export const ProcessGroupProcessContractSchema = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literal("process"),
  controls: Schema.Array(ProcessGroupProcessControlSchema),
});

/**
 * Serializable process capability record for a typed ProcessGroup contract.
 *
 * @public
 */
export interface ProcessGroupProcessContract<out Id extends string> {
  readonly id: Id;
  readonly kind: "process";
  readonly controls: ReadonlyArray<ProcessGroupProcessControl>;
}

/**
 * Runtime schema for queue capability records in a group contract.
 *
 * @public
 */
export const ProcessGroupQueueContractSchema = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literal("queue"),
  controls: Schema.Array(ProcessGroupQueueControlSchema),
  item: Schema.optional(QueueItemCodecDescriptorSchema),
});

/**
 * Serializable queue capability record for a typed ProcessGroup contract.
 *
 * @public
 */
export interface ProcessGroupQueueContract<out Id extends string> {
  readonly id: Id;
  readonly kind: "queue";
  readonly controls: ReadonlyArray<ProcessGroupQueueControl>;
  /**
 * Present when the queue declaration included an Effect `itemSchema` on
 * {@link QueueResource.Service}. Used for remote discovery and contract drift checks ahead of remote enqueue.
   */
  readonly item?: QueueItemCodecDescriptor;
}

/**
 * Runtime schema for a typed ProcessGroup contract.
 *
 * @public
 */
export const ProcessGroupContractSchema = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literal("group"),
  version: Schema.Literal("v1"),
  processes: Schema.Array(ProcessGroupProcessContractSchema),
  queues: Schema.Array(ProcessGroupQueueContractSchema),
});

/**
 * Serializable contract exported by a typed ProcessGroup for remote managers,
 * control services, and UI clients.
 *
 * @public
 */
export interface ProcessGroupContract<
  out Id extends string,
  Entries extends readonly ProcessGroupEntry[],
> {
  readonly id: Id;
  readonly kind: "group";
  readonly version: "v1";
  readonly processes: ReadonlyArray<
    ProcessGroupProcessContract<ProcessGroupProcessEntries<Entries>["id"]>
  >;
  readonly queues: ReadonlyArray<
    ProcessGroupQueueContract<ProcessGroupQueueEntries<Entries>["id"]>
  >;
}

/**
 * Process runtime status.
 * @public
 */
export type ProcessStatus = "running" | "stopped";

/**
 * Process status details for monitoring.
 * @public
 */
export interface ProcessGroupDetails {
  readonly name: string;
  readonly type: string;
  readonly status: ProcessStatus;
  readonly uptime: number;
  readonly startTime: Date | null;
  readonly lastRun: Date | null;
  readonly executions: number;
  readonly firstStartup: Date | null;
  readonly armed: boolean;
  readonly nextScheduleTransition: Date | null;
  readonly nextPollCadence: number | null;
  readonly activeInstances: number;
  readonly nextTriggerRun: Date | null;
}

/**
 * Queue status details for monitoring.
 * @public
 */
export interface QueueDetails {
  readonly name: string;
  readonly size: { readonly high: number; readonly normal: number; readonly low: number; readonly total: number };
  readonly completed: number;
}

/**
 * Health summary for the group.
 * @public
 */
export interface GroupHealth {
  readonly healthy: boolean;
  readonly processes: { readonly running: number; readonly stopped: number };
  readonly queues: { readonly active: number };
}

// ============================================================================
// Errors
// ============================================================================

/** @public */
export class ProcessNotFoundError extends Data.TaggedError("ProcessNotFoundError")<{
  readonly processName: string;
}> {}

/** @public */
export class ProcessAlreadyRunningError extends Data.TaggedError("ProcessAlreadyRunningError")<{
  readonly processName: string;
}> {}

/** @public */
export class ProcessNotRunningError extends Data.TaggedError("ProcessNotRunningError")<{
  readonly processName: string;
}> {}

/** @public */
export type ProcessGroupErrors =
  | ProcessNotFoundError
  | ProcessAlreadyRunningError
  | ProcessNotRunningError;

/**
 * Remote group control failed because the network request, protocol response,
 * or decoded payload was not usable.
 *
 * @public
 */
export class ProcessGroupRemoteControlError extends Data.TaggedError(
  "ProcessGroupRemoteControlError",
)<{
  readonly reason: string;
  readonly status?: number;
}> {}

/**
 * Remote group control was requested for an operation that cannot be represented
 * safely over the current group contract.
 *
 * @remarks
 * Queue `add`, `enqueue`, `prioritize`, and `defer` intentionally fail with
 * this error until remote enqueue is implemented (even when local contracts
 * include {@link ProcessGroupQueueContract.item} metadata).
 *
 * @public
 */
export class UnsupportedRemoteControlError extends Data.TaggedError(
  "UnsupportedRemoteControlError",
)<{
  readonly operation: string;
  readonly target: string;
  readonly reason: string;
}> {}

/**
 * Error surface for injectable group services.
 *
 * @remarks
 * Local group construction only produces {@link ProcessGroupErrors}; group
 * services are widened so the same service key can be provided by
 * {@link ProcessGroup.remoteLayer} without hiding network or unsupported-control
 * failures as defects.
 *
 * @public
 */
export type ProcessGroupControlError =
  | ProcessGroupErrors
  | ProcessGroupRemoteControlError
  | UnsupportedRemoteControlError
  | QueueItemValidationError
  | QueueBatchValidationError;

/**
 * Enqueue error channel for a typed queue entry (never when the queue has no item schema).
 *
 * @public
 */
export type ProcessGroupQueueEnqueueError<Queue> =
  Queue extends QueueResourceServiceDefinition<
    any,
    string,
    any,
    any,
    infer EEnqueue,
    any
  >
    ? EEnqueue
    : Queue extends Context.ServiceClass<any, string, QueueHandle<any, any, any, infer EEnqueue>>
      ? EEnqueue
    : Queue extends { readonly Service: QueueHandle<any, any, any, infer EEnqueue> }
      ? EEnqueue
      : Queue extends QueueResourceDefinition<string, any, any, infer EEnqueue, any>
        ? EEnqueue
        : never;

/**
 * Service requirements surfaced on enqueue helpers for a typed queue entry (ambient hooks, etc.).
 *
 * @public
 */
export type ProcessGroupQueueEnqueueRequirements<Queue> =
  Queue extends QueueResourceServiceDefinition<any, string, any, any, any, infer R>
    ? R
    : Queue extends Context.ServiceClass<any, string, QueueHandle<any, any, any, infer R>>
      ? R
      : Queue extends { readonly Service: QueueHandle<any, any, any, infer R> }
        ? R
        : Queue extends QueueResourceDefinition<string, any, any, any, infer R>
          ? R
          : never;

// ============================================================================
// ProcessGroup interface
// ============================================================================

/**
 * The ProcessGroup handle — controls processes and reads queue status.
 *
 * @typeParam R - Combined environment for all managed process effects
 *
 * @public
 */
export interface ProcessGroup<R, Error = ProcessGroupErrors> {
  // ─── Process lifecycle ───
  readonly start: (name: string) => Effect.Effect<void, Error, R>;
  readonly stop: (name: string) => Effect.Effect<void, Error>;
  readonly restart: (name: string) => Effect.Effect<void, Error, R>;
  readonly startAll: () => Effect.Effect<void, Error, R>;
  readonly stopAll: () => Effect.Effect<void, Error>;
  readonly runImmediately: (name: string) => Effect.Effect<void, Error, R>;

  // ─── Status (derived from fiber liveness + ProcessStore) ───
  readonly status: Effect.Effect<{
    readonly processes: ReadonlyArray<ProcessGroupDetails>;
    readonly queues: ReadonlyArray<QueueDetails>;
  }, Error>;
  readonly processStatus: (name: string) => Effect.Effect<ProcessGroupDetails, Error>;
  readonly health: Effect.Effect<GroupHealth, Error>;

  // ─── Queue control (delegates to queue handle) ───
  readonly listQueues: () => Effect.Effect<ReadonlyArray<QueueDetails>, Error>;
  readonly getQueue: (name: string) => Effect.Effect<QueueHandle<any, any, any, any>, Error>;
  readonly pauseQueue: (name: string) => Effect.Effect<void, Error>;
  readonly resumeQueue: (name: string) => Effect.Effect<void, Error>;
  readonly clearQueue: (name: string) => Effect.Effect<number, Error, R>;

  // ─── Shutdown ───
  readonly awaitShutdown: (options?: { readonly logMessage?: (signal: string) => string }) => Effect.Effect<void, Error, Scope.Scope>;
}

/**
 * Typed controls for one process entry in a typed ProcessGroup.
 *
 * @public
 */
export interface TypedProcessControls<R, Error = ProcessGroupErrors> {
  readonly start: Effect.Effect<void, Error, R>;
  readonly stop: Effect.Effect<void, Error>;
  readonly restart: Effect.Effect<void, Error, R>;
  readonly runImmediately: Effect.Effect<void, Error, R>;
  readonly status: Effect.Effect<ProcessGroupDetails, Error>;
}

/**
 * Typed controls for one queue entry in a typed ProcessGroup.
 *
 * @public
 */
export interface TypedQueueControls<
  T,
  Error = ProcessGroupErrors,
  EnqueueError = never,
  EnqueueRequirements = never,
> {
  readonly add: (items: T | ReadonlyArray<T>) =>
    Effect.Effect<void, Error | EnqueueError, EnqueueRequirements>;
  readonly enqueue: (items: T | ReadonlyArray<T>) =>
    Effect.Effect<void, Error | EnqueueError, EnqueueRequirements>;
  readonly prioritize: (items: T | ReadonlyArray<T>) =>
    Effect.Effect<void, Error | EnqueueError, EnqueueRequirements>;
  readonly defer: (items: T | ReadonlyArray<T>) =>
    Effect.Effect<void, Error | EnqueueError, EnqueueRequirements>;
  /** Fork worker pool when {@link QueueResourceConfigBase.autoStart} was `false`. Idempotent. */
  readonly start: Effect.Effect<void, Error, EnqueueRequirements>;
  readonly pause: Effect.Effect<void, Error>;
  readonly resume: Effect.Effect<void, Error>;
  readonly clear: Effect.Effect<number, Error, EnqueueRequirements>;
  readonly status: Effect.Effect<QueueDetails, Error>;
}

/**
 * ProcessGroup handle typed from a canonical entry tuple.
 *
 * @public
 */
export interface TypedProcessGroup<
  out Id extends string,
  Entries extends readonly ProcessGroupEntry[],
  Error = ProcessGroupErrors,
> {
  readonly id: Id;
  readonly entries: Entries;
  readonly contract: ProcessGroupContract<Id, Entries>;
  readonly start: <P extends ProcessGroupProcessEntries<Entries>>(
    process: P,
  ) => Effect.Effect<void, Error, ProcessGroupEntryRequirements<Entries>>;
  readonly stop: <P extends ProcessGroupProcessEntries<Entries>>(
    process: P,
  ) => Effect.Effect<void, Error>;
  readonly restart: <P extends ProcessGroupProcessEntries<Entries>>(
    process: P,
  ) => Effect.Effect<void, Error, ProcessGroupEntryRequirements<Entries>>;
  readonly runImmediately: <P extends ProcessGroupProcessEntries<Entries>>(
    process: P,
  ) => Effect.Effect<void, Error, ProcessGroupEntryRequirements<Entries>>;
  /**
   * Fork deferred queue workers ({@link QueueResourceConfigBase.autoStart} `false`), then start every process that is not already running.
   * Queue {@link TypedQueueControls.start} runs first so workers exist before processes enqueue.
   */
  readonly startAll: () => Effect.Effect<void, Error, ProcessGroupEntryRequirements<Entries>>;
  readonly process: <P extends ProcessGroupProcessEntries<Entries>>(
    process: P,
  ) => TypedProcessControls<ProcessGroupEntryRequirements<Entries>, Error>;
  readonly queue: <Q extends ProcessGroupQueueEntries<Entries>>(
    queue: Q,
  ) => TypedQueueControls<
    ProcessGroupQueueItem<Q>,
    Error,
    ProcessGroupQueueEnqueueError<Q>,
    ProcessGroupQueueEnqueueRequirements<Q>
  >;
  readonly status: ProcessGroup<ProcessGroupEntryRequirements<Entries>, Error>["status"];
  readonly health: Effect.Effect<GroupHealth, Error>;
  readonly awaitShutdown: ProcessGroup<ProcessGroupEntryRequirements<Entries>, Error>["awaitShutdown"];
}

// ============================================================================
// Internal: lifecycle event recording (optional ProcessStore)
// ============================================================================

const recordLifecycle = (event: ProcessLifecycleChangedEvent): Effect.Effect<void> =>
  Effect.flatMap(
    Effect.serviceOption(ProcessStore),
    Option.match({
      onNone: () => Effect.void,
      onSome: (store) =>
        store.append(event).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning(`ProcessStore write failed for process lifecycle "${event.entityId}"`).pipe(
              Effect.annotateLogs("cause", Cause.pretty(cause)),
            )
          ),
        ),
    }),
  );

let lifecycleSeq = 0;
const makeLifecycleEvent = (
  name: string,
  tag: ProcessLifecycleChangedEvent["lifecycle"]["tag"],
): Effect.Effect<ProcessLifecycleChangedEvent> =>
  Effect.map(Clock.currentTimeMillis, (now): ProcessLifecycleChangedEvent => {
    lifecycleSeq++;
    return {
      id: `${name}-lifecycle-${tag.toLowerCase()}-${String(lifecycleSeq)}`,
      type: "process.lifecycle.changed",
      occurredAt: now,
      entityType: "process",
      entityId: name,
      lifecycle: { tag },
    };
  });

// ============================================================================
// Internal: build process details from fiber state
// ============================================================================

const buildProcessDetails = (
  name: string,
  // Internal helper: details only read covariant outputs (`getStatus`), so the
  // requirement parameter is irrelevant here.
  process: Process<any>,
  isRunning: boolean,
  startTime: Date | null,
  nowMs: number,
): Effect.Effect<ProcessGroupDetails> =>
  Effect.map(process.getStatus(), (details): ProcessGroupDetails => ({
    name,
    type: process.type,
    status: isRunning ? "running" : "stopped",
    uptime: startTime !== null ? nowMs - startTime.getTime() : 0,
    startTime,
    lastRun: details.lastRun,
    executions: details.executions,
    firstStartup: details.firstStartup,
    armed: details.armed,
    nextScheduleTransition: Option.getOrNull(details.nextScheduleTransition),
    nextPollCadence: Option.match(details.nextPollCadence, {
      onNone: () => null,
      onSome: (d) => Duration.toMillis(d),
    }),
    activeInstances: details.activeInstances,
    nextTriggerRun: Option.getOrNull(details.nextTriggerRun),
  }));

// ============================================================================
// Core: ProcessGroup.make
// ============================================================================

/**
 * Create a ProcessGroup orchestrator.
 *
 * @public
 */
export const makeProcessGroup = <
  const Queues extends ReadonlyArray<ProcessGroupQueueTag>,
  const Processes extends readonly Process<any>[],
>(config: {
  readonly queues: Queues;
  readonly processes: Processes;
}): Effect.Effect<
  ProcessGroup<AllGroupProcessesRequirements<Processes>>,
  ProcessGroupErrors,
  TagIdentifier<Queues[number]>
> =>
  Effect.gen(function* () {
    type R = AllGroupProcessesRequirements<Processes>;

    // ─── Resolve queue tags from context ───
    const queueMap: Record<string, QueueHandle<unknown, unknown, unknown, any>> = {};
    for (const queueTag of config.queues) {
      queueMap[queueTag.key] = yield* queueTag;
    }

    // ─── Build process registry ───
    const processMap = new Map<string, Process<R>>();
    for (const p of config.processes) {
      processMap.set(p.name, p);
    }

    // ─── FiberMap: the core state — fiber liveness IS process status ───
    const fibers = yield* FiberMap.make<string, void>();
    const startTimes = yield* Ref.make(new Map<string, Date>());

    // ─── Process lifecycle ───

    const start = (name: string): Effect.Effect<void, ProcessGroupErrors, R> =>
      Effect.gen(function* () {
        const process = processMap.get(name);
        if (process === undefined) return yield* new ProcessNotFoundError({ processName: name });

        const running = yield* FiberMap.has(fibers, name);
        if (running) return yield* new ProcessAlreadyRunningError({ processName: name });

        yield* Effect.logDebug(`Starting process: ${name}`);
        yield* FiberMap.run(fibers, name)(process.effect);
        const startedAt = yield* Effect.map(Clock.currentTimeMillis, (ms) =>
          DateTime.toDateUtc(DateTime.makeUnsafe(ms)),
        );
        yield* Ref.update(startTimes, (m) => new Map([...m, [name, startedAt]]));
        yield* Effect.flatMap(makeLifecycleEvent(name, "Started"), recordLifecycle);
        yield* Effect.logInfo(`Process '${name}' is running`);
      });

    const stop = (name: string): Effect.Effect<void, ProcessGroupErrors> =>
      Effect.gen(function* () {
        const process = processMap.get(name);
        if (process === undefined) return yield* new ProcessNotFoundError({ processName: name });

        const running = yield* FiberMap.has(fibers, name);
        if (!running) return yield* new ProcessNotRunningError({ processName: name });

        yield* FiberMap.remove(fibers, name);
        yield* Ref.update(startTimes, (m) => { const next = new Map(m); next.delete(name); return next; });
        yield* Effect.flatMap(makeLifecycleEvent(name, "Stopped"), recordLifecycle);
        yield* Effect.logInfo(`Process '${name}' stopped`);
      });

    const restart = (name: string): Effect.Effect<void, ProcessGroupErrors, R> =>
      Effect.gen(function* () {
        const running = yield* FiberMap.has(fibers, name);
        if (running) yield* stop(name);
        yield* start(name);
        yield* Effect.flatMap(makeLifecycleEvent(name, "Restarted"), recordLifecycle);
      });

    const startAll = (): Effect.Effect<void, ProcessGroupErrors, R> =>
      Effect.gen(function* () {
        for (const queue of Object.values(queueMap)) {
          yield* queue.start;
        }
        for (const name of processMap.keys()) {
          const running = yield* FiberMap.has(fibers, name);
          if (!running) yield* start(name);
        }
      });

    const stopAll = (): Effect.Effect<void, ProcessGroupErrors> =>
      Effect.gen(function* () {
        for (const name of processMap.keys()) {
          const running = yield* FiberMap.has(fibers, name);
          if (running) yield* stop(name);
        }
      });

    const runImmediately = (name: string): Effect.Effect<void, ProcessGroupErrors, R> =>
      Effect.gen(function* () {
        const process = processMap.get(name);
        if (process === undefined) return yield* new ProcessNotFoundError({ processName: name });
        yield* process.runImmediately();
      });

    // ─── Status ───

    const processStatus = (name: string): Effect.Effect<ProcessGroupDetails, ProcessGroupErrors> =>
      Effect.gen(function* () {
        const process = processMap.get(name);
        if (process === undefined) return yield* new ProcessNotFoundError({ processName: name });
        const running = yield* FiberMap.has(fibers, name);
        const times = yield* Ref.get(startTimes);
        const nowMs = yield* Clock.currentTimeMillis;
        return yield* buildProcessDetails(name, process, running, times.get(name) ?? null, nowMs);
      });

    const allProcessStatus = (): Effect.Effect<ReadonlyArray<ProcessGroupDetails>> =>
      Effect.gen(function* () {
        const times = yield* Ref.get(startTimes);
        const nowMs = yield* Clock.currentTimeMillis;
        const results: ProcessGroupDetails[] = [];
        for (const [name, process] of processMap) {
          const running = yield* FiberMap.has(fibers, name);
          results.push(yield* buildProcessDetails(name, process, running, times.get(name) ?? null, nowMs));
        }
        return results;
      });

    const listQueues = (): Effect.Effect<ReadonlyArray<QueueDetails>> =>
      Effect.gen(function* () {
        const results: QueueDetails[] = [];
        for (const [name, queue] of Object.entries(queueMap)) {
          const sizes = yield* queue.sizes;
          const total = yield* queue.size;
          const completed = yield* queue.completed;
          results.push({ name, size: { ...sizes, total }, completed });
        }
        return results;
      });

    const getQueue = (
      name: string,
    ): Effect.Effect<QueueHandle<unknown, unknown, unknown, any>, ProcessGroupErrors> => {
      const queue = queueMap[name];
      if (queue === undefined) return Effect.fail(new ProcessNotFoundError({ processName: name }));
      return Effect.succeed(queue);
    };

    const pauseQueue = (name: string): Effect.Effect<void, ProcessGroupErrors> =>
      Effect.flatMap(getQueue(name), (q) => q.pause);

    const resumeQueue = (name: string): Effect.Effect<void, ProcessGroupErrors> =>
      Effect.flatMap(getQueue(name), (q) => q.resume);

    const clearQueue = (name: string): Effect.Effect<number, ProcessGroupErrors, R> =>
      Effect.flatMap(getQueue(name), (q) => q.clear);

    const statusEffect = Effect.gen(function* () {
      const processes = yield* allProcessStatus();
      const queues = yield* listQueues();
      return { processes, queues };
    });

    const healthEffect: Effect.Effect<GroupHealth> = Effect.gen(function* () {
      let running = 0;
      let stopped = 0;
      for (const name of processMap.keys()) {
        const isRunning = yield* FiberMap.has(fibers, name);
        if (isRunning) running++; else stopped++;
      }
      return {
        healthy: stopped === 0,
        processes: { running, stopped },
        queues: { active: Object.keys(queueMap).length },
      };
    });

    // ─── Shutdown ───

    const awaitShutdown = (options?: { readonly logMessage?: (signal: string) => string }): Effect.Effect<void, never, Scope.Scope> =>
      Effect.gen(function* () {
        const signal = yield* Effect.callback<string>((resume: (effect: Effect.Effect<string>) => void) => {
          const handler = (sig: string) => { resume(Effect.succeed(sig)); };
          process.on("SIGINT", () => handler("SIGINT"));
          process.on("SIGTERM", () => handler("SIGTERM"));
        });
        const msg = options?.logMessage !== undefined
          ? options.logMessage(signal)
          : `Received ${signal}, shutting down...`;
        yield* Effect.logInfo(msg);
        yield* stopAll().pipe(Effect.ignore);
      });


    // ─── Build the group handle ───

    const group: ProcessGroup<R> = {
      start,
      stop,
      restart,
      startAll,
      stopAll,
      runImmediately,
      status: statusEffect,
      processStatus,
      health: healthEffect,
      listQueues,
      getQueue,
      pauseQueue,
      resumeQueue,
      clearQueue,
      awaitShutdown,
    };

    return group;
  });

export function makeTypedProcessGroupEffect<
  const Id extends string,
  const Entries extends readonly ProcessGroupEntry[],
>(
  id: Id,
  entries: Entries,
): Effect.Effect<
  TypedProcessGroup<Id, Entries>,
  ProcessGroupErrors,
  TypedProcessGroupQueueRequirements<Entries>
>;
export function makeTypedProcessGroupEffect<
  const Id extends string,
  const Entries extends readonly ProcessGroupEntry[],
  const ConfigItems extends readonly ProcessManagerGroupConfigItem[],
>(
  id: Id,
  entries: Entries,
  config: ConfigItems,
): Effect.Effect<
  TypedProcessGroup<Id, Entries>,
  ProcessGroupErrors,
  TypedProcessGroupQueueRequirements<Entries>
>;
export function makeTypedProcessGroupEffect<
  const Queues extends ReadonlyArray<ProcessGroupQueueTag>,
  const Processes extends readonly Process<any>[],
>(config: {
  readonly queues: Queues;
  readonly processes: Processes;
}): Effect.Effect<
  ProcessGroup<AllGroupProcessesRequirements<Processes>>,
  ProcessGroupErrors,
  TagIdentifier<Queues[number]>
>;
export function makeTypedProcessGroupEffect(
  idOrConfig:
    | string
    | {
        readonly queues: ReadonlyArray<ProcessGroupQueueTag>;
        readonly processes: readonly Process<any>[];
      },
  entries?: readonly ProcessGroupEntry[],
  _config?: readonly ProcessManagerGroupConfigItem[],
) {
  if (typeof idOrConfig === "string") {
    return makeTypedProcessGroup(idOrConfig, entries ?? []);
  }
  return makeProcessGroup(idOrConfig);
}

const processGroupKind = "group" as const;
const processGroupContractVersion = "v1" as const;
const processGroupProcessControls: ReadonlyArray<ProcessGroupProcessControl> = [
  "start",
  "stop",
  "restart",
  "runImmediately",
  "status",
];
const processGroupQueueControls: ReadonlyArray<ProcessGroupQueueControl> = [
  "enqueue",
  "start",
  "pause",
  "resume",
  "clear",
  "status",
];
const processGroupSchemaQueueControls: ReadonlyArray<ProcessGroupQueueControl> = [
  "enqueue",
  "release",
  "start",
  "pause",
  "resume",
  "clear",
  "status",
];

// Preserve per-tuple literals by using type-predicate callbacks on `entries`
// (`filter` narrowing is better behaved here than iterative `push` widenings).
const processEntriesFrom = <const Entries extends readonly ProcessGroupEntry[]>(
  entries: Entries,
): ReadonlyArray<Extract<Entries[number], { readonly kind: "process" }>> =>
  entries.filter(
    (entry): entry is Extract<Entries[number], { readonly kind: "process" }> =>
      entry.kind === "process",
  );

const queueEntriesFrom = <const Entries extends readonly ProcessGroupEntry[]>(
  entries: Entries,
): ReadonlyArray<Extract<Entries[number], { readonly kind: "queue" }>> =>
  entries.filter(
    (entry): entry is Extract<Entries[number], { readonly kind: "queue" }> =>
      entry.kind === "queue",
  );

const makeProcessContract = <P extends ProcessDefinition<string, unknown>>(
  process: P,
): ProcessGroupProcessContract<P["id"]> => ({
  id: process.id,
  kind: "process",
  controls: processGroupProcessControls,
});

const makeQueueContract = (
  queue: Extract<ProcessGroupEntry, { readonly kind: "queue" }>,
): ProcessGroupQueueContract<(typeof queue)["id"]> => ({
  id: queue.id,
  kind: "queue",
  controls: queue.item === undefined ? processGroupQueueControls : processGroupSchemaQueueControls,
  ...(queue.item !== undefined ? { item: queue.item } : {}),
});

const makeProcessGroupContract = <
  const Id extends string,
  const Entries extends readonly ProcessGroupEntry[],
>(
  id: Id,
  entries: Entries,
): ProcessGroupContract<Id, Entries> => ({
  id,
  kind: processGroupKind,
  version: processGroupContractVersion,
  processes: processEntriesFrom(entries).map(makeProcessContract),
  queues: queueEntriesFrom(entries).map(makeQueueContract),
});

const nullableDateFromString = Schema.NullOr(Schema.DateFromString);

const queueDetailsSchema = Schema.Struct({
  name: Schema.String,
  size: Schema.Struct({
    high: Schema.Number,
    normal: Schema.Number,
    low: Schema.Number,
    total: Schema.Number,
  }),
  completed: Schema.Number,
});

const processGroupDetailsSchema = Schema.Struct({
  name: Schema.String,
  type: Schema.String,
  status: Schema.Literals(["running", "stopped"] as const),
  uptime: Schema.Number,
  startTime: nullableDateFromString,
  lastRun: nullableDateFromString,
  executions: Schema.Number,
  firstStartup: nullableDateFromString,
  armed: Schema.Boolean,
  nextScheduleTransition: nullableDateFromString,
  nextPollCadence: Schema.NullOr(Schema.Number),
  activeInstances: Schema.Number,
  nextTriggerRun: nullableDateFromString,
});

const processGroupStatusSchema = Schema.Struct({
  processes: Schema.Array(processGroupDetailsSchema),
  queues: Schema.Array(queueDetailsSchema),
});

const clearQueueResponseDataSchema = Schema.Struct({
  cleared: Schema.Number,
});

interface RemoteControlResponse<T = unknown> {
  readonly success: boolean;
  readonly type?: "process" | "queue";
  readonly data?: T;
  readonly error?: string;
}

/**
 * Injectable typed group service declaration produced by
 * {@link ProcessGroup.Service}.
 *
 * @public
 */
export interface ProcessGroupServiceDefinition<
  Self,
  Id extends string,
  Entries extends readonly ProcessGroupEntry[],
  ConfigItems extends readonly ProcessManagerGroupConfigItem[] = readonly [],
> extends Context.ServiceClass<
    Self,
    Id,
    TypedProcessGroup<Id, Entries, ProcessGroupControlError>
  > {
  readonly id: Id;
  readonly kind: "group";
  readonly entries: Entries;
  readonly config: ConfigItems;
  readonly contract: ProcessGroupContract<Id, Entries>;
  /**
   * Build the local group implementation.
   *
   * @remarks
   * The local implementation has the narrower {@link ProcessGroupErrors} control
   * surface; yielding the service key is widened to {@link ProcessGroupControlError}
   * so remote providers can use the same key honestly.
   */
  readonly make: Effect.Effect<
    TypedProcessGroup<Id, Entries>,
    ProcessGroupErrors,
    TypedProcessGroupQueueRequirements<Entries>
  >;
  readonly layer: Layer.Layer<
    Self,
    ProcessGroupErrors,
    ProcessGroupServiceLayerRequirements<Entries>
  >;
}

/**
 * Minimal endpoint service shape accepted by {@link ProcessGroup.remoteLayer}.
 *
 * @public
 */
export interface ProcessGroupRemoteEndpointDefinition<
  Self,
  Id extends string,
  Entries extends readonly ProcessGroupEntry[],
  Requirements = HttpClient.HttpClient,
> extends Context.ServiceClass<
    Self,
    string,
    RemoteProcessManager<ProcessGroupContract<Id, Entries>, Requirements>
  > {
  readonly contract: ProcessGroupContract<Id, Entries>;
}

const statusFromUnknownError = (error: unknown): number | undefined => {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return undefined;
  }
  const status = error.status;
  return typeof status === "number" ? status : undefined;
};

const reasonFromUnknownError = (error: unknown): string => {
  if (typeof error === "object" && error !== null && "reason" in error) {
    const reason = error.reason;
    if (typeof reason === "string") {
      return reason;
    }
  }
  return String(error);
};

const toRemoteControlError = (error: unknown): ProcessGroupRemoteControlError =>
  new ProcessGroupRemoteControlError({
    reason: reasonFromUnknownError(error),
    status: statusFromUnknownError(error),
  });

const decodeRemoteData = <S extends Schema.Top & { readonly DecodingServices: never }>(
  response: RemoteControlResponse<unknown>,
  schema: S,
  description: string,
): Effect.Effect<S["Type"], ProcessGroupRemoteControlError> => {
  if (response.data === undefined) {
    return Effect.fail(
      new ProcessGroupRemoteControlError({
        reason: `Remote ${description} response did not include data`,
      }),
    );
  }
  return Schema.decodeUnknownEffect(schema)(response.data).pipe(
    Effect.mapError(
      (cause) =>
        new ProcessGroupRemoteControlError({
          reason: `Malformed remote ${description} response: ${String(cause)}`,
        }),
    ),
  );
};

const unsupportedRemoteQueueEnqueue = (
  operation: string,
  target: string,
): Effect.Effect<void, UnsupportedRemoteControlError> =>
  Effect.fail(
    new UnsupportedRemoteControlError({
      operation,
      target,
      reason: "Remote queue enqueue requires schema-backed queue item contracts",
    }),
  );

const unsupportedRemoteAwaitShutdown = (
  target: string,
): Effect.Effect<void, UnsupportedRemoteControlError> =>
  Effect.fail(
    new UnsupportedRemoteControlError({
      operation: "awaitShutdown",
      target,
      reason: "Remote groups cannot install local process signal handlers",
    }),
  );

const makeRemoteTypedProcessGroup = <
  Self,
  const Id extends string,
  const Entries extends readonly ProcessGroupEntry[],
  Requirements,
>(
  group: ProcessGroupServiceDefinition<Self, Id, Entries>,
  manager: RemoteProcessManager<ProcessGroupContract<Id, Entries>, Requirements>,
  runRemote: <A>(
    effect: Effect.Effect<A, unknown, Requirements>,
  ) => Effect.Effect<A, ProcessGroupRemoteControlError>,
): TypedProcessGroup<Id, Entries, ProcessGroupControlError> => {
  const processStatus = (
    id: ProcessGroupProcessEntries<Entries>["id"],
  ): Effect.Effect<ProcessGroupDetails, ProcessGroupControlError> =>
    Effect.flatMap(
      runRemote(manager.process(id).status),
      (response) => decodeRemoteData(response, processGroupDetailsSchema, "process status"),
    );

  const queueStatus = (
    id: ProcessGroupQueueEntries<Entries>["id"],
  ): Effect.Effect<QueueDetails, ProcessGroupControlError> =>
    Effect.flatMap(
      runRemote(manager.queue(id).status),
      (response) => decodeRemoteData(response, queueDetailsSchema, "queue status"),
    );

  const clearQueue = (
    id: ProcessGroupQueueEntries<Entries>["id"],
  ): Effect.Effect<number, ProcessGroupControlError> =>
    Effect.flatMap(
      runRemote(manager.queue(id).clear),
      (response) =>
        Effect.map(
          decodeRemoteData(response, clearQueueResponseDataSchema, "queue clear"),
          (data) => data.cleared,
        ),
    );

  const status: TypedProcessGroup<Id, Entries, ProcessGroupControlError>["status"] =
    Effect.flatMap(
      runRemote(manager.status),
      (response) => decodeRemoteData(response, processGroupStatusSchema, "group status"),
    );

  const health: Effect.Effect<GroupHealth, ProcessGroupControlError> =
    Effect.map(status, (groupStatus) => {
      const running = groupStatus.processes.filter((process) => process.status === "running").length;
      const stopped = groupStatus.processes.length - running;
      return {
        healthy: stopped === 0,
        processes: { running, stopped },
        queues: { active: groupStatus.queues.length },
      };
    });

  const processById = (
    id: ProcessGroupProcessEntries<Entries>["id"],
  ): TypedProcessControls<
    ProcessGroupEntryRequirements<Entries>,
    ProcessGroupControlError
  > => ({
    start: runRemote(manager.process(id).start),
    stop: runRemote(manager.process(id).stop),
    restart: runRemote(manager.process(id).restart),
    runImmediately: runRemote(manager.process(id).runImmediately),
    status: processStatus(id),
  });

  const queueById = <Q extends ProcessGroupQueueEntries<Entries>>(
    queue: Q,
  ): TypedQueueControls<ProcessGroupQueueItem<Q>, ProcessGroupControlError> => ({
    add: (_items: ProcessGroupQueueItem<Q> | ReadonlyArray<ProcessGroupQueueItem<Q>>) =>
      unsupportedRemoteQueueEnqueue("queue.add", queue.id),
    enqueue: (_items: ProcessGroupQueueItem<Q> | ReadonlyArray<ProcessGroupQueueItem<Q>>) =>
      unsupportedRemoteQueueEnqueue("queue.enqueue", queue.id),
    prioritize: (_items: ProcessGroupQueueItem<Q> | ReadonlyArray<ProcessGroupQueueItem<Q>>) =>
      unsupportedRemoteQueueEnqueue("queue.prioritize", queue.id),
    defer: (_items: ProcessGroupQueueItem<Q> | ReadonlyArray<ProcessGroupQueueItem<Q>>) =>
      unsupportedRemoteQueueEnqueue("queue.defer", queue.id),
    start: runRemote(manager.queue(queue.id).start),
    pause: runRemote(manager.queue(queue.id).pause),
    resume: runRemote(manager.queue(queue.id).resume),
    clear: clearQueue(queue.id),
    status: queueStatus(queue.id),
  });

  return {
    id: group.id,
    entries: group.entries,
    contract: group.contract,
    start: (process) => runRemote(manager.process(process.id).start),
    stop: (process) => runRemote(manager.process(process.id).stop),
    restart: (process) => runRemote(manager.process(process.id).restart),
    runImmediately: (process) => runRemote(manager.process(process.id).runImmediately),
    startAll: () =>
      Effect.gen(function* () {
        for (const q of queueEntriesFrom(group.entries)) {
          yield* runRemote(manager.queue(q.id).start);
        }
        for (const p of processEntriesFrom(group.entries)) {
          yield* runRemote(manager.process(p.id).start);
        }
      }),
    process: (process) => processById(process.id),
    queue: queueById,
    status,
    health,
    awaitShutdown: () => unsupportedRemoteAwaitShutdown(group.id),
  };
};

/**
 * Provide a {@link ProcessGroup.Service} key with a network-backed implementation
 * from a {@link ProcessManager.Endpoint}.
 *
 * @remarks
 * The caller still yields the same group service key, but controls are routed
 * through the endpoint transport requirements. Process controls and
 * queue start/pause/resume/clear/status are supported. Queue enqueue-style methods
 * fail with {@link UnsupportedRemoteControlError} until queue item schemas are
 * represented in the group contract.
 *
 * @public
 */
const remoteLayer = <
  Self,
  const Id extends string,
  const Entries extends readonly ProcessGroupEntry[],
  EndpointSelf,
  Requirements,
>(
  group: ProcessGroupServiceDefinition<Self, Id, Entries>,
  endpoint: ProcessGroupRemoteEndpointDefinition<EndpointSelf, Id, Entries, Requirements>,
): Layer.Layer<Self, never, EndpointSelf | Requirements> =>
  Layer.effect(group)(
    Effect.gen(function* () {
      const manager = yield* endpoint;
      const context = yield* Effect.context<Requirements>();
      const runRemoteUnverified = <A>(
        effect: Effect.Effect<A, unknown, Requirements>,
      ): Effect.Effect<A, ProcessGroupRemoteControlError> =>
        Effect.provide(effect, context).pipe(
          Effect.mapError(toRemoteControlError),
        );
      const verifyRemote = yield* Effect.cached(runRemoteUnverified(manager.verifyContract));
      const runRemote = <A>(
        effect: Effect.Effect<A, unknown, Requirements>,
      ): Effect.Effect<A, ProcessGroupRemoteControlError> =>
        Effect.flatMap(verifyRemote, () => runRemoteUnverified(effect));
      return makeRemoteTypedProcessGroup(group, manager, runRemote);
    }),
  );

/** Runtime queue declarations carry the Context tag used to acquire the live queue handle. */
function hasProcessGroupRuntimeQueueTag<const Entries extends readonly ProcessGroupEntry[]>(
  entry: ProcessGroupQueueEntries<Entries>,
): entry is ProcessGroupQueueEntries<Entries> & {
  readonly tag: ProcessGroupQueueTag;
} {
  return "tag" in entry;
}

const mergeBundledQueueLayersFor = <Entries extends readonly ProcessGroupEntry[]>(
  first: Layer.Layer<any, never, ProcessGroupBundledQueueLayerContext<Entries>>,
  rest: ReadonlyArray<Layer.Layer<any, never, ProcessGroupBundledQueueLayerContext<Entries>>>,
): Layer.Layer<any, never, ProcessGroupBundledQueueLayerContext<Entries>> =>
  rest.length === 0 ? first : rest.reduce((acc, layer) => Layer.merge(acc, layer), first);

const makeTypedProcessGroup = <
  const Id extends string,
  const Entries extends readonly ProcessGroupEntry[],
>(
  id: Id,
  entries: Entries,
): Effect.Effect<
  TypedProcessGroup<Id, Entries>,
  ProcessGroupErrors,
  TypedProcessGroupQueueRequirements<Entries>
> =>
  Effect.gen(function* () {
    const contract = makeProcessGroupContract(id, entries);
    const processes = processEntriesFrom(entries);
    const queuesAll = queueEntriesFrom(entries);
    const queuesRuntime = queuesAll
      .filter(hasProcessGroupRuntimeQueueTag)
      .map((queue) => queue.tag);

    const runtime = yield* makeProcessGroup({
      processes: processes.map((process) => process.process),
      queues: queuesRuntime,
    });

    const queueStatus = (
      queueId: string,
    ): Effect.Effect<QueueDetails, ProcessGroupErrors> =>
      Effect.gen(function* () {
        const queue = yield* runtime.getQueue(queueId);
        const sizes = yield* queue.sizes;
        const total = yield* queue.size;
        const completed = yield* queue.completed;
        return {
          name: queueId,
          size: { ...sizes, total },
          completed,
        };
      });

    return {
      id,
      entries,
      contract,
      start: (process) => runtime.start(process.id),
      stop: (process) => runtime.stop(process.id),
      restart: (process) => runtime.restart(process.id),
      runImmediately: (process) => runtime.runImmediately(process.id),
      startAll: runtime.startAll,
      process: (process) => ({
        start: runtime.start(process.id),
        stop: runtime.stop(process.id),
        restart: runtime.restart(process.id),
        runImmediately: runtime.runImmediately(process.id),
        status: runtime.processStatus(process.id),
      }),
      queue: (queue) => ({
        add: (items) =>
          Effect.flatMap(runtime.getQueue(queue.id), (handle) => handle.add(items)),
        enqueue: (items) =>
          Effect.flatMap(runtime.getQueue(queue.id), (handle) => handle.add(items)),
        prioritize: (items) =>
          Effect.flatMap(
            runtime.getQueue(queue.id),
            (handle) => handle.prioritize(items),
          ),
        defer: (items) =>
          Effect.flatMap(runtime.getQueue(queue.id), (handle) => handle.defer(items)),
        start: Effect.flatMap(runtime.getQueue(queue.id), (handle) => handle.start),
        pause: runtime.pauseQueue(queue.id),
        resume: runtime.resumeQueue(queue.id),
        clear: runtime.clearQueue(queue.id),
        status: queueStatus(queue.id),
      }),
      status: runtime.status,
      health: runtime.health,
      awaitShutdown: runtime.awaitShutdown,
    };
  });

// Merge queue resource layers bundled on typed entries into the group layer so
// `yield*` / `runPromise` callers do not have to compose queue Layers manually.
const queueContributionLayersFrom = <Entries extends readonly ProcessGroupEntry[]>(
  entries: Entries,
): ReadonlyArray<
  Layer.Layer<any, never, ProcessGroupBundledQueueLayerContext<Entries>>
> =>
  entries
    .filter(
      (
        e,
      ): e is Extract<Entries[number], { readonly kind: "queue" }> & {
        readonly layer: Layer.Layer<any, never, ProcessGroupBundledQueueLayerContext<Entries>>;
      } =>
        e.kind === "queue" &&
        e.layer !== undefined,
    )
    .map((q) => q.layer);

function makeProcessGroupServiceFactory<Self>() {
  function service<
    const Id extends string,
    const Entries extends readonly ProcessGroupEntry[],
  >(
    id: Id,
    entries: Entries,
  ): ProcessGroupServiceDefinition<Self, Id, Entries>;
  function service<
    const Id extends string,
    const Entries extends readonly ProcessGroupEntry[],
    const ConfigItems extends readonly ProcessManagerGroupConfigItem[],
  >(
    id: Id,
    entries: Entries,
    configItems: ConfigItems,
  ): ProcessGroupServiceDefinition<Self, Id, Entries, ConfigItems>;
  function service<
    const Id extends string,
    const Entries extends readonly ProcessGroupEntry[],
    const ConfigItems extends readonly ProcessManagerGroupConfigItem[],
  >(
    id: Id,
    entries: Entries,
    configItems?: ConfigItems,
  ) {
    const groupConfigItems = configItems ?? emptyProcessGroupConfigItems;
    const base = Context.Service<
      Self,
      TypedProcessGroup<Id, Entries, ProcessGroupControlError>
    >()(id);
    const contract = makeProcessGroupContract(id, entries);
    const make = makeTypedProcessGroup(id, entries);
    const queueContrib = queueContributionLayersFrom(entries);
    const bundledForBuild =
      queueContrib.length === 0
        ? undefined
        : mergeBundledQueueLayersFor<Entries>(queueContrib[0]!, queueContrib.slice(1));
    const baseLayer = Layer.effect(base)(make);
    const built =
      bundledForBuild === undefined ? baseLayer : baseLayer.pipe(Layer.provide(bundledForBuild));
    /** Re-merge queue layers so the same tags stay in scope for handlers (e.g. ControlService) after `yield* Group`. */
    const layer: Layer.Layer<Self, ProcessGroupErrors, ProcessGroupServiceLayerProvided<Entries>> =
      bundledForBuild === undefined ? built : Layer.merge(built, bundledForBuild);
    // Match Effect's class-based service style: the class is yieldable, and the
    // static fields expose group identity/contract/config data for control surfaces.
    return Object.assign(base, {
      id,
      kind: processGroupKind,
      entries,
      config: groupConfigItems,
      contract,
      make,
      layer,
    });
  }
  return service;
}

export interface ProcessGroupLocalEnvLayerOptions {
  /**
   * Analytics/lifecycle store for process supervisors. Defaults to
   * {@link ProcessStore.layer}.
   */
  readonly store?: Layer.Layer<ProcessStore, never, Scope.Scope>;
}

const processEntryIsService = (
  entry: Extract<ProcessGroupEntry, { readonly kind: "process" }>,
): entry is ProcessServiceDefinition<any, string, any> => "layer" in entry;

const processContributionLayersFrom = <Entries extends readonly ProcessGroupEntry[]>(
  entries: Entries,
): ReadonlyArray<Layer.Layer<never, never, unknown>> => {
  const layers: Array<Layer.Layer<never, never, unknown>> = [];
  for (const entry of processEntriesFrom(entries)) {
    if (processEntryIsService(entry)) {
      layers.push(entry.layer);
    }
  }
  return layers;
};

const buildLocalEnvLayer = <
  Self,
  const Entries extends readonly ProcessGroupEntry[],
>(
  groupId: string,
  groupLayer: Layer.Layer<
    Self,
    ProcessGroupErrors,
    ProcessGroupServiceLayerProvided<Entries>
  >,
  entries: Entries,
  options: ProcessGroupLocalEnvLayerOptions = {},
)=> {
  const store = options.store ?? ProcessStore.layer;
  const logContext = layerProcessGroupLogContext(groupId);
  const processLayers = processContributionLayersFrom(entries);
  const queueContrib = queueContributionLayersFrom(entries);
  const bundledQueues =
    queueContrib.length === 0
      ? undefined
      : mergeBundledQueueLayersFor<Entries>(queueContrib[0]!, queueContrib.slice(1));

  if (processLayers.length === 0) {
    return groupLayer.pipe(Layer.provide(store), Layer.provideMerge(logContext));
  }

  const processLayersWithQueues =
    bundledQueues === undefined
      ? processLayers
      : processLayers.map((processLayer) => processLayer.pipe(Layer.provide(bundledQueues)));

  const mergedProcessLayers: Layer.Layer<never, never, unknown> =
    processLayersWithQueues.length === 1
      ? processLayersWithQueues[0]!
      : processLayersWithQueues.reduce<Layer.Layer<never, never, unknown>>(
          (acc, processLayer) => Layer.merge(acc, processLayer),
          processLayersWithQueues[0]!,
        );

  const inner = groupLayer.pipe(
    Layer.provide(Layer.merge(mergedProcessLayers, store)),
    Layer.provideMerge(logContext),
  );
  if (bundledQueues === undefined) {
    return Layer.merge(inner, store);
  }
  return Layer.merge(Layer.merge(inner, bundledQueues), store);
};

/**
 * Build the env layer for a local group child runtime: {@link ProcessGroup.Service.layer}
 * with process layers (group queue layers satisfy process `R`) and {@link ProcessStore}.
 *
 * @remarks
 * Queue layers are already bundled on the group layer; this helper does **not**
 * duplicate them at the root. Process layers receive bundled queue layers only to
 * close each process effect's requirements.
 *
 * @public
 */
export const localEnvLayer = <
  Self,
  const Id extends string,
  const Entries extends readonly ProcessGroupEntry[],
  const ConfigItems extends readonly ProcessManagerGroupConfigItem[] = readonly [],
>(
  group: ProcessGroupServiceDefinition<Self, Id, Entries, ConfigItems>,
  options?: ProcessGroupLocalEnvLayerOptions,
) => buildLocalEnvLayer(group.id, group.layer, group.entries, options);

// ============================================================================
// Public namespace
// ============================================================================

/**
 * ProcessGroup namespace.
 *
 * @public
 */
export const ProcessGroup = {
  make: makeTypedProcessGroupEffect,
  Service: makeProcessGroupServiceFactory,
  remoteLayer,
  localEnvLayer,
};

export { QueueItemValidationError, QueueBatchValidationError } from "./QueueResource";

/**
 * Control surface type used by ControlService.
 * @public
 */
export type ProcessGroupControls<R = never, Error = ProcessGroupErrors> = ProcessGroup<R, Error>;

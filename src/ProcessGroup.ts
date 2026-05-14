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
 * yield* group.startAll()
 * yield* group.status
 * yield* ProcessGroup.awaitShutdown(group)
 * ```
 *
 * @module ProcessGroup
 */

import { Clock, Data, DateTime, Duration, Effect, FiberMap, Option, Ref, Scope } from "effect";
import type { Context } from "effect";
import type { Process } from "./Process";
import type { QueueHandle } from "./QueueResource";
import {
  ProcessStore,
  type ProcessLifecycleChangedEvent,
} from "./ProcessStore";

// ============================================================================
// Public Types
// ============================================================================

/** @internal */
type TagIdentifier<T> = T extends Context.Key<infer I, infer _> ? I : never;

/**
 * Extract the service requirements from a Process handle.
 * @public
 */
export type ProcessEffectRequirements<P> = P extends Process<infer R> ? R : never;

/**
 * Union of requirements for all processes in a tuple.
 * @public
 */
export type AllGroupProcessesRequirements<
  Processes extends readonly Process<any>[],
> = ProcessEffectRequirements<Processes[number]>;

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
export interface ProcessGroup<R> {
  // ─── Process lifecycle ───
  readonly start: (name: string) => Effect.Effect<void, ProcessGroupErrors, R>;
  readonly stop: (name: string) => Effect.Effect<void, ProcessGroupErrors>;
  readonly restart: (name: string) => Effect.Effect<void, ProcessGroupErrors, R>;
  readonly startAll: () => Effect.Effect<void, ProcessGroupErrors, R>;
  readonly stopAll: () => Effect.Effect<void, ProcessGroupErrors>;
  readonly runImmediately: (name: string) => Effect.Effect<void, ProcessGroupErrors, R>;

  // ─── Status (derived from fiber liveness + ProcessStore) ───
  readonly status: Effect.Effect<{
    readonly processes: ReadonlyArray<ProcessGroupDetails>;
    readonly queues: ReadonlyArray<QueueDetails>;
  }>;
  readonly processStatus: (name: string) => Effect.Effect<ProcessGroupDetails, ProcessGroupErrors>;
  readonly health: Effect.Effect<GroupHealth>;

  // ─── Queue control (delegates to queue handle) ───
  readonly listQueues: () => Effect.Effect<ReadonlyArray<QueueDetails>>;
  readonly getQueue: (name: string) => Effect.Effect<QueueHandle<any, any, any>, ProcessGroupErrors>;
  readonly pauseQueue: (name: string) => Effect.Effect<void, ProcessGroupErrors>;
  readonly resumeQueue: (name: string) => Effect.Effect<void, ProcessGroupErrors>;
  readonly clearQueue: (name: string) => Effect.Effect<number, ProcessGroupErrors>;

  // ─── Shutdown ───
  readonly awaitShutdown: (options?: { readonly logMessage?: (signal: string) => string }) => Effect.Effect<void, never, Scope.Scope>;
}

// ============================================================================
// Internal: lifecycle event recording (optional ProcessStore)
// ============================================================================

const recordLifecycle = (event: ProcessLifecycleChangedEvent): Effect.Effect<void> =>
  Effect.flatMap(
    Effect.serviceOption(ProcessStore),
    Option.match({
      onNone: () => Effect.void,
      onSome: (store) => store.append(event).pipe(Effect.ignore),
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
  const Queues extends readonly [...Context.Key<any, QueueHandle<any, any, any>>[]],
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
    const queueMap: Record<string, QueueHandle<any, any, any>> = {};
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

    const getQueue = (name: string): Effect.Effect<QueueHandle<any, any, any>, ProcessGroupErrors> => {
      const queue = queueMap[name];
      if (queue === undefined) return Effect.fail(new ProcessNotFoundError({ processName: name }));
      return Effect.succeed(queue);
    };

    const pauseQueue = (name: string): Effect.Effect<void, ProcessGroupErrors> =>
      Effect.flatMap(getQueue(name), (q) => q.pause);

    const resumeQueue = (name: string): Effect.Effect<void, ProcessGroupErrors> =>
      Effect.flatMap(getQueue(name), (q) => q.resume);

    const clearQueue = (name: string): Effect.Effect<number, ProcessGroupErrors> =>
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

// ============================================================================
// Public namespace
// ============================================================================

/**
 * ProcessGroup namespace.
 *
 * @public
 */
export const ProcessGroup = {
  make: makeProcessGroup,
} as const;

/**
 * Control surface type used by ControlService.
 * @public
 */
export type ProcessGroupControls<R = never> = ProcessGroup<R>;

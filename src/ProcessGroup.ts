/**
 * **ProcessGroup** — orchestration for a cohesive set of processes and queues.
 *
 * A {@link ProcessGroup} owns processes that belong together: their lifecycle,
 * scheduling, queue access, and analytics. It is the unit of deployment
 * within `effect-pm`.
 *
 * A future top-level `ProcessManager` (not yet implemented) will coordinate
 * multiple `ProcessGroup` instances across hosts via Effect RPC / HTTP. Use
 * a single `ProcessGroup` per logical bundle for now.
 *
 * @remarks
 * Key features:
 * - Process lifecycle management (start, stop, restart)
 * - Real-time status monitoring and metrics
 * - Queue resource integration and management
 * - Scoped resource management with automatic cleanup when a managed process
 *   supervisor **ends** unexpectedly or after `stop` / interrupt
 *
 * **Schedule vs lifecycle:** `ProcessGroup.make` does **not** start supervisors; call
 * `startProcess` / `startAll` first. Arm/disarm (from `ProcessSchedule`) controls whether
 * **ticks** run while the supervisor fiber is attached. See `docs/SCHEDULE-AND-PROCESSGROUP.md`.
 *
 * **Dependencies:**
 * - `ProcessStore` - Required for process analytics and lifecycle records.
 *   Provide either `ProcessStore.layer` (in-memory) or a custom implementation.
 *
 * @module ProcessGroup
 */

import { Clock, DateTime, Duration, Effect, Scope, Fiber, Ref, Data, Context, Exit, Option } from "effect";
import type { Process, ProcessDetails } from "./Process";
import type { QueueRef } from "./QueueResource";
import { ControlService } from "./ControlService";
import { ProcessStore, type ProcessLifecycleChangedEvent } from "./ProcessStore";

// ============================================================================
// Type Utilities
// ============================================================================

/**
 * Extract the identifier type from a Context.Key
 * @internal
 */
type TagIdentifier<T> = T extends Context.Key<infer I, infer _> ? I : never;

// ============================================================================
// Public Types
// ============================================================================

/**
 * Environment required to run a process's scheduled `effect` (including
 * {@link ProcessStore}, which process runtime analytics uses).
 *
 * @public
 */
export type ProcessEffectRequirements<P> = P extends Process<any>
  ? Effect.Services<P["effect"]>
  : never;

/**
 * Union of {@link ProcessEffectRequirements} for every process in a tuple.
 *
 * @remarks
 * {@link ProcessGroup.make} uses this so `startAll`, `startProcess`, and
 * related controls carry the same combined environment you would thread
 * through any nested `Effect`.
 *
 * @public
 */
export type AllGroupProcessesRequirements<
  Processes extends readonly Process<any>[],
> = ProcessEffectRequirements<Processes[number]>;

/**
 * Builds the internal process map: each concrete process is assignable to
 * `Process<PGR>` because {@link Process} is covariant in `R` and `PGR` is the
 * union of every process effect's environment.
 *
 * @internal
 */
const queueInstance = <Identifier, Q extends QueueRef<any, any, any, any>>(
  tag: Context.Key<Identifier, Q>,
): Effect.Effect<Q, never, Identifier> => tag.asEffect();

const processMapFromTuple = <const Processes extends readonly Process<any>[]>(
  processes: Processes,
): Map<string, Process<AllGroupProcessesRequirements<Processes>>> => {
  const map = new Map<
    string,
    Process<AllGroupProcessesRequirements<Processes>>
  >();
  for (const p of processes) {
    map.set(p.name, p);
  }
  return map;
};

/**
 * ProcessGroup core dependencies.
 *
 * @remarks
 * `ProcessStore` provides analytics persistence for process execution and
 * lifecycle. A default in-memory implementation is available via
 * `ProcessStore.layer`.
 *
 * @public
 */
export type ProcessGroupDependencies = ProcessStore;

/**
 * Process status managed by ProcessGroup.
 *
 * @remarks
 * - `running` - Process is actively running
 * - `paused` - Process is paused (not currently implemented)
 * - `stopped` - Process is stopped
 *
 * @public
 */
export type ProcessStatus = "running" | "paused" | "stopped";

/**
 * Detailed information about a managed process.
 *
 * @public
 */
export interface ProcessGroupDetails {
  /** Unique process identifier */
  name: string;
  /** Process type */
  type: "managed" | "scheduled" | "service";
  /** Current process status */
  status: ProcessStatus;
  /** Milliseconds since process start */
  uptime: number;
  /** When the process was started (null if never started) */
  startTime: Date | null;

  /** Last execution time for scheduled processes */
  lastRun?: Date | null;
  /** Next schedule transition (cron / gate), when known */
  nextRun?: Date | null;
  /** Whether the process schedule gate is armed (polling allowed). */
  armed?: boolean;
  /** Best-effort next poll cadence in milliseconds, when known */
  nextPollCadenceMs?: number | null;
  /** Number of currently running process instances, when known */
  activeInstances?: number;
  /** Best-effort next trigger timestamp, when known */
  nextTriggerRun?: Date | null;
  /** Total number of executions */
  executions?: number;
  /** First execution flagged as startup in analytics, when known */
  firstStartup?: Date | null;

  /** Current number of items in queue */
  size?: number;
  /** Total number of items completed */
  completed?: number;
  /** Number of concurrent workers */
  workers?: number;
  /** Whether the queue is currently processing */
  running?: boolean;

  /** Additional metadata for extensions */
  metadata?: Record<string, unknown>;
}

/**
 * Internal state for ProcessGroup.
 * @internal
 */
export interface ProcessGroupState<R> {
  processes: Ref.Ref<Map<string, Process<R>>>;
  queues: Record<string, QueueRef<any, any, any, any>>;
  statuses: Ref.Ref<Map<string, ProcessStatus>>;
  startTimes: Ref.Ref<Map<string, Date>>;
  scopes: Ref.Ref<Map<string, Scope.Scope>>;
  fibers: Ref.Ref<Map<string, Fiber.Fiber<void, never>>>;
}

/**
 * Queue resource status information.
 *
 * @public
 */
export interface QueueDetails {
  name: string;
  size: {
    high: number;
    normal: number;
    low: number;
    total: number;
  };
  completed: number;
}

/**
 * ProcessGroup control surface.
 *
 * @typeParam R - Combined environment for all managed processes' runnable effects
 *
 * @public
 */
export interface ProcessGroupControls<R> {
  removeProcess(name: string): Effect.Effect<void, ProcessGroupErrors>;
  listProcesses(): Effect.Effect<ProcessGroupDetails[], ProcessGroupErrors, ProcessStore>;

  startProcess(
    name: string,
  ): Effect.Effect<void, ProcessGroupErrors, R | ProcessStore>;
  stopProcess(name: string): Effect.Effect<void, ProcessGroupErrors>;
  restartProcess(
    name: string,
  ): Effect.Effect<void, ProcessGroupErrors, R | ProcessStore>;

  runProcessImmediately(
    name: string,
  ): Effect.Effect<void, ProcessGroupErrors, R | ProcessStore>;

  getProcessStatus(
    name: string,
  ): Effect.Effect<ProcessGroupDetails, ProcessGroupErrors, ProcessStore>;
  getAllProcessStatus(): Effect.Effect<
    ProcessGroupDetails[],
    ProcessGroupErrors,
    ProcessStore
  >;

  startAll(): Effect.Effect<void, ProcessGroupErrors, R | ProcessStore>;
  stopAll(): Effect.Effect<void, ProcessGroupErrors>;

  listQueues(): Effect.Effect<QueueDetails[], never>;
  getQueue(
    name: string,
  ): Effect.Effect<QueueRef<any, any, any, any>, ProcessGroupErrors>;
}

/**
 * Options for {@link ProcessGroup} shutdown waiting (Node.js signals).
 *
 * @public
 */
export interface AwaitShutdownOptions {
  readonly signals?: readonly string[];
  readonly logMessage?: (signal: string) => string | undefined;
}

/**
 * Public ProcessGroup interface returned by {@link ProcessGroup.make}.
 *
 * @public
 */
export interface ProcessGroup<R> extends ProcessGroupControls<R> {
  serve: ({ port }: { port?: number }) => Effect.Effect<void, never, Scope.Scope | R | ProcessStore>;
  awaitShutdown: (
    options?: AwaitShutdownOptions,
  ) => Effect.Effect<void, never, Scope.Scope>;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * General ProcessGroup error.
 *
 * @public
 */
export class ProcessGroupError extends Data.TaggedError(
  "ProcessGroupError",
)<{
  reason: string;
  processName?: string;
  operation?: string;
}> {}

/**
 * Error thrown when a process is not found.
 *
 * @public
 */
export class ProcessNotFoundError extends Data.TaggedError(
  "ProcessNotFoundError",
)<{
  processName: string;
}> {}

/**
 * Error thrown when attempting to start a process that is already running.
 *
 * @public
 */
export class ProcessAlreadyRunningError extends Data.TaggedError(
  "ProcessAlreadyRunningError",
)<{
  processName: string;
}> {}

/**
 * Error thrown when attempting an operation on a process that is not running.
 *
 * @public
 */
export class ProcessNotRunningError extends Data.TaggedError(
  "ProcessNotRunningError",
)<{
  processName: string;
  operation: string;
}> {}

/**
 * Union of all possible ProcessGroup errors.
 *
 * @public
 */
export type ProcessGroupErrors =
  | ProcessGroupError
  | ProcessNotFoundError
  | ProcessAlreadyRunningError
  | ProcessNotRunningError;

const defaultShutdownSignals = ["SIGINT", "SIGTERM"] as const;

const awaitShutdownNode = (
  options?: AwaitShutdownOptions,
): Effect.Effect<never, never, Scope.Scope> =>
  Effect.gen(function* () {
    const signals = options?.signals ?? defaultShutdownSignals;
    const entries: Array<{ readonly sig: string; readonly fn: () => void }> =
      [];

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const { sig, fn } of entries) {
          process.off(sig, fn);
        }
        entries.length = 0;
      }),
    );

    return yield* Effect.callback<never>((resume) => {
      let done = false;
      for (const sig of signals) {
        const fn = () => {
          if (done) return;
          done = true;
          for (const e of entries) {
            process.off(e.sig, e.fn);
          }
          entries.length = 0;

          const resolved =
            options?.logMessage !== undefined
              ? options.logMessage(sig)
              : `Received ${sig}, shutting down gracefully...`;

          const log =
            resolved !== undefined && resolved !== ""
              ? Effect.logInfo(resolved)
              : Effect.void;

          resume(Effect.andThen(log, () => Effect.interrupt));
        };
        entries.push({ sig, fn });
        process.on(sig, fn);
      }
    });
  });

const awaitShutdown = (
  options?: AwaitShutdownOptions,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.asVoid(
    typeof process !== "undefined" && typeof process.on === "function"
      ? awaitShutdownNode(options)
      : Effect.andThen(
          Effect.logWarning(
            "ProcessGroup.awaitShutdown: process.on is not available; blocking forever. Use a Node.js entrypoint.",
          ),
          () => Effect.never,
        ),
  );

const recordLifecycleIfAvailable = (event: ProcessLifecycleChangedEvent): Effect.Effect<void> =>
  Effect.serviceOption(ProcessStore).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.void,
        onSome: (store) => store.append(event),
      }),
    ),
  );

// ============================================================================
// Helper Functions (Internal)
// ============================================================================

const removeProcess =
  <R>(state: ProcessGroupState<R>) =>
  (name: string): Effect.Effect<void, ProcessGroupErrors> =>
    Effect.gen(function* () {
      yield* Effect.logDebug(`🗑️  Removing process: ${name}`);

      const process = yield* Ref.get(state.processes).pipe(
        Effect.map((processes) => processes.get(name)),
      );

      if (process === undefined) {
        return yield* new ProcessNotFoundError({ processName: name });
      }

      const status = yield* Ref.get(state.statuses).pipe(
        Effect.map((statuses) => statuses.get(name)),
      );

      if (status === "running") {
        yield* stopProcess(state)(name);
      }

      yield* Ref.update(state.processes, (processes) => {
        const newMap = new Map(processes);
        newMap.delete(name);
        return newMap;
      });
      yield* Ref.update(state.statuses, (statuses) => {
        const newMap = new Map(statuses);
        newMap.delete(name);
        return newMap;
      });
      yield* Ref.update(state.startTimes, (startTimes) => {
        const newMap = new Map(startTimes);
        newMap.delete(name);
        return newMap;
      });
      yield* Ref.update(state.scopes, (scopes) => {
        const newMap = new Map(scopes);
        newMap.delete(name);
        return newMap;
      });
      yield* Ref.update(state.fibers, (fibers) => {
        const newMap = new Map(fibers);
        newMap.delete(name);
        return newMap;
      });

      yield* Effect.logInfo(`✅ Process '${name}' removed successfully`);
    });

const processDetailsToGroupFields = (details: ProcessDetails) => ({
  lastRun: details.lastRun,
  nextRun: Option.match(details.nextTriggerRun, {
    onNone: () => Option.getOrNull(details.nextScheduleTransition),
    onSome: (d) => d,
  }),
  executions: details.executions,
  firstStartup: details.firstStartup,
  armed: details.armed,
  nextPollCadenceMs: Option.match(details.nextPollCadence, {
    onNone: () => null,
    onSome: (d) => Duration.toMillis(d),
  }),
  activeInstances: details.activeInstances,
  nextTriggerRun: Option.getOrNull(details.nextTriggerRun),
});

const listProcesses = <R>(
  state: ProcessGroupState<R>,
): Effect.Effect<ProcessGroupDetails[], ProcessGroupErrors, ProcessStore> =>
  Effect.gen(function* () {
    const processes = yield* Ref.get(state.processes);
    const statuses = yield* Ref.get(state.statuses);
    const startTimes = yield* Ref.get(state.startTimes);

    const detailsPromises = Array.from(processes.entries()).map(
      ([name, process]) =>
        Effect.gen(function* () {
          const status = statuses.get(name) ?? "stopped";
          const startTime = startTimes.get(name) ?? null;
          const nowMillis = yield* Clock.currentTimeMillis;
          const uptime = startTime === null ? 0 : nowMillis - startTime.getTime();

          let scheduledDetails: Record<string, unknown> = {};
          if (process.type === "managed" || process.type === "scheduled") {
            const details = yield* process.getStatus();
            scheduledDetails = processDetailsToGroupFields(details);
          }

          return {
            name,
            type: process.type,
            status,
            uptime,
            startTime,
            ...scheduledDetails,
            metadata: {
              hasRunImmediately: "runImmediately" in process,
            },
          };
        }),
    );

    return yield* Effect.all(detailsPromises);
  });

/**
 * Closes the process scope, clears fork maps, marks stopped, and records lifecycle.
 * Does **not** interrupt the fiber (caller interrupts first when stopping manually).
 */
const releaseProcessForkResources =
  <R>(state: ProcessGroupState<R>) =>
  (name: string): Effect.Effect<void, never, never> =>
    Effect.gen(function* () {
      const scope = yield* Ref.get(state.scopes).pipe(
        Effect.map((scopes) => scopes.get(name)),
      );

      if (scope !== undefined) {
        yield* Scope.close(scope, Exit.void);
      }

      yield* Ref.update(state.statuses, (statuses) => statuses.set(name, "stopped"));
      yield* Ref.update(state.fibers, (fibers) => {
        const next = new Map(fibers);
        next.delete(name);
        return next;
      });
      yield* Ref.update(state.scopes, (scopes) => {
        const next = new Map(scopes);
        next.delete(name);
        return next;
      });
      const stoppedAt = yield* DateTime.nowAsDate;
      yield* recordLifecycleIfAvailable({
        id: `${name}-lifecycle-stopped-${stoppedAt.getTime()}`,
        type: "process.lifecycle.changed",
        occurredAt: stoppedAt,
        entityType: "process",
        entityId: name,
        lifecycle: { tag: "Stopped" },
      });
    });

const startProcess =
  <R>(state: ProcessGroupState<R>) =>
  (name: string): Effect.Effect<void, ProcessGroupErrors, R | ProcessStore> =>
    Effect.gen(function* () {
      yield* Effect.logDebug(`🚀 Starting process: ${name}`);

      const process = yield* Ref.get(state.processes).pipe(
        Effect.map((processes) => processes.get(name)),
      );

      if (process === undefined) {
        return yield* new ProcessNotFoundError({ processName: name });
      }

      const status = yield* Ref.get(state.statuses).pipe(
        Effect.map((statuses) => statuses.get(name)),
      );

      if (status === "running") {
        return yield* new ProcessAlreadyRunningError({ processName: name });
      }

      if (status === "stopped") {
        yield* Effect.logInfo(`📝 Process '${name}' is starting`);
      }

      const scope = yield* Scope.make();
      const fiber = yield* Effect.forkIn(process.effect, scope);

      yield* Ref.update(state.scopes, (scopes) => scopes.set(name, scope));
      yield* Ref.update(state.fibers, (fibers) => fibers.set(name, fiber));
      yield* Ref.update(state.statuses, (statuses) =>
        statuses.set(name, "running"),
      );
      const startedAt = yield* DateTime.nowAsDate;
      yield* Ref.update(state.startTimes, (startTimes) => startTimes.set(name, startedAt));
      yield* recordLifecycleIfAvailable({
        id: `${name}-lifecycle-started-${startedAt.getTime()}`,
        type: "process.lifecycle.changed",
        occurredAt: startedAt,
        entityType: "process",
        entityId: name,
        lifecycle: { tag: "Started" },
      });

      yield* Effect.forkDetach(
        Fiber.join(fiber).pipe(
          Effect.exit,
          Effect.flatMap((exit) =>
            Exit.match(exit, {
              onSuccess: () =>
                Effect.gen(function* () {
                  const st = yield* Ref.get(state.statuses).pipe(
                    Effect.map((statuses) => statuses.get(name)),
                  );
                  if (st === "running") {
                    yield* releaseProcessForkResources(state)(name);
                    yield* Effect.logInfo(
                      `🛑 Process '${name}' supervisor ended unexpectedly; marked stopped.`,
                    );
                  }
                }),
              onFailure: () => Effect.void,
            }),
          ),
        ),
      );

      yield* Effect.logInfo(`✅ '${name}' is running`);
    });

const stopProcess =
  <R>(state: ProcessGroupState<R>) =>
  (name: string): Effect.Effect<void, ProcessGroupErrors> =>
    Effect.gen(function* () {
      const process = yield* Ref.get(state.processes).pipe(
        Effect.map((processes) => processes.get(name)),
      );

      if (process === undefined) {
        return yield* new ProcessNotFoundError({ processName: name });
      }

      const status = yield* Ref.get(state.statuses).pipe(
        Effect.map((statuses) => statuses.get(name)),
      );

      if (status !== "running") {
        return yield* new ProcessNotRunningError({
          processName: name,
          operation: "stop",
        });
      }

      const fiber = yield* Ref.get(state.fibers).pipe(
        Effect.map((fibers) => fibers.get(name)),
      );

      if (fiber !== undefined) {
        yield* Fiber.interrupt(fiber);
      }

      yield* releaseProcessForkResources(state)(name);

      yield* Effect.logInfo(`✅ Process '${name}' stopped successfully`);
    });

const runProcessImmediately =
  <R>(state: ProcessGroupState<R>) =>
  (name: string): Effect.Effect<void, ProcessGroupErrors, R | ProcessStore> =>
    Effect.gen(function* () {
      const process = yield* Ref.get(state.processes).pipe(
        Effect.map((processes) => processes.get(name)),
      );

      if (process === undefined) {
        return yield* new ProcessNotFoundError({ processName: name });
      }

      if ("runImmediately" in process) {
        yield* Effect.logInfo(`🚀 Running '${name}' immediately...`);
        yield* process.runImmediately();
      } else {
        return yield* new ProcessGroupError({
          reason: "unsupported_immediate_execution",
          processName: name,
          operation: "runImmediately",
        });
      }
    });

const getProcessStatus =
  <R>(state: ProcessGroupState<R>) =>
  (name: string): Effect.Effect<ProcessGroupDetails, ProcessGroupErrors, ProcessStore> =>
    Effect.gen(function* () {
      const process = yield* Ref.get(state.processes).pipe(
        Effect.map((processes) => processes.get(name)),
      );

      if (process === undefined) {
        return yield* new ProcessNotFoundError({ processName: name });
      }

      const status = yield* Ref.get(state.statuses).pipe(
        Effect.map((statuses) => statuses.get(name)),
      );
      const startTime = yield* Ref.get(state.startTimes).pipe(
        Effect.map((startTimes) => startTimes.get(name)),
      );
      const nowMillis = yield* Clock.currentTimeMillis;
      const uptime = startTime === undefined ? 0 : nowMillis - startTime.getTime();

      const details = yield* process.getStatus().pipe(
        Effect.mapError(
          () =>
            new ProcessGroupError({
              reason: "status_details_error",
              processName: name,
              operation: "status",
            }),
        ),
      );

      return {
        name,
        type: process.type,
        status: status ?? "stopped",
        uptime,
        startTime: startTime ?? null,
        ...processDetailsToGroupFields(details),
      };
    });

// ============================================================================
// Public API
// ============================================================================

/**
 * Create a {@link ProcessGroup} instance.
 *
 * @remarks
 * A `ProcessGroup` coordinates the processes and queues that need to run
 * together. It provides:
 * - Lifecycle management for all processes
 * - Unified control interface (start, stop, restart)
 * - Status monitoring and metrics
 * - Queue resource integration and access
 *
 * @typeParam Queues - Array of queue resource service tags to manage
 * @typeParam Processes - Tuple of {@link Process} values; used to infer combined requirements
 *
 * @example
 * ```typescript
 * import { QueueResource, Process, ProcessGroup, Polling, ProcessSchedule } from "@nikscripts/effect-pm";
 * import { Duration, Effect } from "effect";
 *
 * const EmailQueue = QueueResource.make({
 *   name: "email-queue",
 *   effect: sendEmail,
 *   concurrency: 5,
 * });
 *
 * const emailWorker = Process.make({
 *   name: "send-emails",
 *   effect: Effect.gen(function* () {
 *     const queue = yield* EmailQueue;
 *     yield* queue.add([email1, email2, email3]);
 *   }),
 *   polling: Polling.spaced(Duration.minutes(5)),
 *   schedule: ProcessSchedule.inMemory([
 *     ProcessSchedule.window("email-window", new Date(0), new Date(30 * 60 * 1000)),
 *   ]),
 * });
 *
 * const group = yield* ProcessGroup.make({
 *   queues: [EmailQueue],
 *   processes: [emailWorker],
 * });
 *
 * yield* group.startAll();
 * ```
 *
 * @public
 */
export const makeProcessGroup = <
  const Queues extends readonly [
    ...Context.Key<any, QueueRef<any, any, any, any>>[],
  ],
  const Processes extends readonly Process<any>[],
>(config: {
  queues: Queues;
  processes: Processes;
}): Effect.Effect<
  ProcessGroup<AllGroupProcessesRequirements<Processes>>,
  ProcessGroupErrors,
  TagIdentifier<Queues[number]>
> =>
  Effect.gen(function* () {
    type PGR = AllGroupProcessesRequirements<Processes>;

    const queues: Record<string, QueueRef<any, any, any, any>> = {};
    for (const queueTag of config.queues) {
      queues[queueTag.key] = yield* queueInstance(queueTag);
    }

    const processMap = processMapFromTuple(config.processes);
    const statusMap = new Map<string, ProcessStatus>();
    for (const name of processMap.keys()) {
      statusMap.set(name, "stopped");
    }

    const processes = yield* Ref.make(processMap);
    const statuses = yield* Ref.make(statusMap);
    const startTimes = yield* Ref.make(new Map<string, Date>());
    const scopes = yield* Ref.make(new Map<string, Scope.Scope>());
    const fibers = yield* Ref.make(
      new Map<string, Fiber.Fiber<void, never>>(),
    );

    const state: ProcessGroupState<PGR> = {
      processes,
      queues,
      statuses,
      startTimes,
      scopes,
      fibers,
    };

    const controls = {
      removeProcess: removeProcess(state),
      listProcesses: () => listProcesses(state),
      startProcess: (name: string) =>
        Effect.andThen(
          Effect.logInfo(`🚀 Starting process: ${name}`),
          startProcess(state)(name),
        ),
      stopProcess: (name: string) =>
        Effect.andThen(
          Effect.logInfo(`🛑 Stopping process: ${name}`),
          stopProcess(state)(name),
        ),
      restartProcess: (name: string) =>
        Effect.gen(function* () {
          yield* stopProcess(state)(name);
          yield* startProcess(state)(name);
          const restartedAt = yield* DateTime.nowAsDate;
          yield* recordLifecycleIfAvailable({
            id: `${name}-lifecycle-restarted-${restartedAt.getTime()}`,
            type: "process.lifecycle.changed",
            occurredAt: restartedAt,
            entityType: "process",
            entityId: name,
            lifecycle: { tag: "Restarted" },
          });
        }),
      runProcessImmediately: runProcessImmediately(state),
      getProcessStatus: getProcessStatus(state),
      getAllProcessStatus: () => listProcesses(state),
      startAll: () =>
        Effect.gen(function* () {
          const processes = yield* Ref.get(state.processes);
          for (const name of processes.keys()) {
            const status = yield* Ref.get(state.statuses).pipe(
              Effect.map((m) => m.get(name)),
            );
            if (status !== "running") {
              yield* startProcess(state)(name);
            }
          }
        }),
      stopAll: () =>
        Effect.gen(function* () {
          const processes = yield* Ref.get(state.processes);
          for (const name of processes.keys()) {
            const status = yield* Ref.get(state.statuses).pipe(
              Effect.map((m) => m.get(name)),
            );
            if (status === "running") {
              yield* stopProcess(state)(name);
            }
          }
        }),
      listQueues: () =>
        Effect.all(
          Object.entries(state.queues).map(([name, queue]) =>
            Effect.gen(function* () {
              const prioritySizes = yield* queue.sizeByPriority();
              const totalSize = yield* queue.size();
              const completed = yield* queue.getCompleted();
              return {
                name,
                size: {
                  high: prioritySizes.high,
                  normal: prioritySizes.normal,
                  low: prioritySizes.low,
                  total: totalSize,
                },
                completed,
              };
            }),
          ),
        ),
      getQueue: (name: string) =>
        Effect.gen(function* () {
          const queue = state.queues[name];
          if (queue === undefined) {
            return yield* new ProcessNotFoundError({ processName: name });
          }
          return queue;
        }),
    };
    return {
      ...controls,
      serve: ({ port }: { port?: number }) => ControlService.make({ group: controls, port }),
      awaitShutdown,
    };
  });

/**
 * `ProcessGroup` namespace.
 *
 * @public
 */
export const ProcessGroup = {
  make: makeProcessGroup,
};

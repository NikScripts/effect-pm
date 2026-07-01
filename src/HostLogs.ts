/**
 * **Host logs** — capture, stream, and **durably store** every log emitted in a runtime, queryable
 * **by host** or **by resource**.
 *
 * @remarks
 * `HostLogs.layer` installs a runtime-wide capture logger + an in-memory sliding relay ({@link stream}
 * / {@link snapshot} for live watch), the runtime-wide complement to a resource's own `logs` stream.
 *
 * `HostLogs.persistLayer(host)` adds **durable** storage: it forks a batched writer that appends every
 * captured line to {@link LogStore}, **bucketed by `host`**, with each line's resource annotations
 * (`processId` / `queueId`) preserved. So stored logs are queryable two ways:
 *
 * - {@link byHost} — every line a host emitted (across all its resources);
 * - {@link byResource} — every line a specific queue/process emitted (across hosts).
 *
 * Storage is whatever `ProcessStorage.layer` composes ({@link LogStore} rides `RuntimeStorage` —
 * memory / sqlite / redis). It's opt-in: without `persistLayer`, logs are the in-memory tail only.
 *
 * ```ts
 * const HostLive = myHost.pipe(
 *   Effect.provide(HostLogs.layer),
 *   Effect.provide(HostLogs.persistLayer("wnba")), // requires LogStore (ProcessStorage.layer)
 * );
 * // later, anywhere with LogStore in context:
 * const hostLines = yield* HostLogs.byHost("wnba", { limit: 200 });
 * const queueLines = yield* HostLogs.byResource({ queueId: "BoxScoreQueue" });
 * ```
 *
 * @module HostLogs
 */
import { Duration, Effect, Layer, Logger, Queue, Ref, Stream } from "effect";
import { CurrentLogAnnotations, CurrentLogSpans } from "effect/References";
import { LogRelay, captureLogger, relayOnlyLayer } from "./Logs";
import { LogAnnotationKeys } from "./LogContext";
import type { LogEntry } from "./LogEntry";
import { logEntryFromLoggerOptions } from "./LogEntry";
import { LogStore } from "./store/log";
import type { LogQuery, LogSort } from "./internal/manager/logQuery";
import { LogQueryError } from "./internal/manager/logQuery";

/**
 * A captured host log line — the element of {@link stream}. (Alias of the package's structured log
 * entry; the neutral name is the public face.)
 *
 * @public
 */
export type HostLogEntry = LogEntry;

/**
 * Install runtime-wide log capture: a sliding relay plus a **merged** capture logger that publishes
 * every log line to it. Provide at your app root; then read {@link stream} / {@link snapshot} (they
 * require the relay this layer provides). Merged, so it never silences your existing loggers.
 *
 * @public
 */
export const layer: Layer.Layer<LogRelay> = Layer.merge(
  relayOnlyLayer,
  Logger.layer([captureLogger], { mergeWithExisting: true }),
);

/**
 * The recent captured tail (bounded), read once — for a first paint. {@link stream} already prepends it.
 *
 * @public
 */
export const snapshot: Effect.Effect<ReadonlyArray<HostLogEntry>, never, LogRelay> = Effect.flatMap(
  LogRelay,
  (relay) => relay.snapshot,
);

/**
 * The live host log stream: the recent tail replayed first, then live lines. Requires {@link layer}.
 *
 * @public
 */
export const stream: Stream.Stream<HostLogEntry, never, LogRelay> = Stream.unwrap(
  Effect.gen(function* () {
    const relay = yield* LogRelay;
    const tail = yield* relay.snapshot;
    return Stream.concat(Stream.fromIterable(tail), relay.stream);
  }),
);

/**
 * Durably store this host's logs: forks a **batched** writer that appends every captured line to
 * {@link LogStore}, **bucketed by `host`**, stamping each line with the `host` annotation while
 * preserving its `processId` / `queueId`. Requires {@link layer} (for the relay) and a `LogStore`
 * (compose `ProcessStorage.layer` + a backend). The forked writer lives for the layer's scope.
 *
 * @public
 */
export const persistLayer = (host: string): Layer.Layer<never, never, LogStore> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const store = yield* LogStore;
      // a durable buffer created at layer-build: the logger below offers into it (synchronously, from
      // the moment it's installed — no subscription race), a forked writer batches out of it.
      const queue = yield* Queue.unbounded<HostLogEntry>();
      const counter = yield* Ref.make(0);
      yield* Effect.forkScoped(
        Stream.runForEach(
          // Effect-native windowing: up to 64 lines or every 250ms, whichever first
          Stream.groupedWithin(Stream.fromQueue(queue), 64, Duration.millis(250)),
          (entries) =>
            Effect.gen(function* () {
              const start = yield* Ref.getAndUpdate(counter, (n) => n + entries.length);
              const rows = entries.map((entry, index) => ({
                // monotonic, zero-padded so it sorts + works as a cursor
                entryId: String(start + index).padStart(12, "0"),
                entry: {
                  ...entry,
                  annotations: { ...entry.annotations, [LogAnnotationKeys.host]: host },
                },
              }));
              return yield* store.recordBatch(host, rows).pipe(Effect.orDie);
            }),
        ),
      );
      // a merged capture logger that builds a structured entry and offers it to the buffer
      const logger = Logger.make<unknown, void>((options) => {
        const entry = logEntryFromLoggerOptions({
          message: options.message,
          logLevel: options.logLevel,
          cause: options.cause,
          date: options.date,
          annotations: options.fiber.getRef(CurrentLogAnnotations),
          spans: options.fiber.getRef(CurrentLogSpans),
        });
        options.fiber.currentDispatcher.scheduleTask(() => {
          Effect.runForkWith(options.fiber.context)(Queue.offer(queue, entry));
        }, 0);
      });
      return Logger.layer([logger], { mergeWithExisting: true });
    }),
  );

const queryLimitDefault = 200;

const runQuery = (
  query: LogQuery,
): Effect.Effect<ReadonlyArray<HostLogEntry>, never, LogStore> =>
  Effect.flatMap(LogStore, (store) => store.load(query)).pipe(
    // an empty match is `[]`, not an error, for a query API
    Effect.catchIf(
      (error): error is LogQueryError => error instanceof LogQueryError,
      () => Effect.succeed<ReadonlyArray<HostLogEntry>>([]),
    ),
    // a storage failure (backend down) is a defect for a best-effort log read
    Effect.orDie,
  );

/** Options shared by {@link byHost} / {@link byResource}. @public */
export interface LogReadOptions {
  readonly limit?: number;
  readonly sort?: LogSort;
  readonly from?: Date;
  readonly to?: Date;
}

/**
 * Read the durable logs for a **whole host** (every resource on it), newest first. Requires
 * {@link LogStore}; returns `[]` if none match.
 *
 * @public
 */
export const byHost = (
  host: string,
  options?: LogReadOptions,
): Effect.Effect<ReadonlyArray<HostLogEntry>, never, LogStore> =>
  runQuery({
    groupId: host,
    limit: options?.limit ?? queryLimitDefault,
    sort: options?.sort ?? "desc",
    ...(options?.from === undefined ? {} : { from: options.from }),
    ...(options?.to === undefined ? {} : { to: options.to }),
  });

/**
 * Read the durable logs for a **specific resource** (a queue/process, across hosts), newest first.
 * Requires {@link LogStore}; returns `[]` if none match.
 *
 * @public
 */
export const byResource = (
  resource: { readonly processId?: string; readonly queueId?: string },
  options?: LogReadOptions,
): Effect.Effect<ReadonlyArray<HostLogEntry>, never, LogStore> =>
  runQuery({
    ...(resource.processId === undefined ? {} : { processId: resource.processId }),
    ...(resource.queueId === undefined ? {} : { queueId: resource.queueId }),
    limit: options?.limit ?? queryLimitDefault,
    sort: options?.sort ?? "desc",
    ...(options?.from === undefined ? {} : { from: options.from }),
    ...(options?.to === undefined ? {} : { to: options.to }),
  });

/**
 * Host logs — runtime-wide capture + live stream + durable, host/resource-queryable storage.
 * See the {@link HostLogs | module docs}.
 *
 * @public
 */
export const HostLogs = {
  layer,
  stream,
  snapshot,
  persistLayer,
  byHost,
  byResource,
  /** The backing relay service (provided by {@link layer}). */
  Relay: LogRelay,
} as const;

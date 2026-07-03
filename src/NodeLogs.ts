/**
 * **Node logs** — capture, stream, and **durably store** every log emitted in a runtime, queryable
 * **by node** or **by resource**.
 *
 * @remarks
 * `NodeLogs.layer` installs a runtime-wide capture logger + an in-memory sliding relay ({@link stream}
 * / {@link snapshot} for live watch), the runtime-wide complement to a resource's own `logs` stream.
 *
 * `NodeLogs.persistLayer(node)` adds **durable** storage: it forks a batched writer that appends every
 * captured line to {@link LogStore}, **bucketed by `node`**, with each line's resource annotations
 * (`processId` / `queueId`) preserved. So stored logs are queryable two ways:
 *
 * - {@link byNode} — every line a node emitted (across all its resources);
 * - {@link byResource} — every line a specific queue/process emitted (across nodes).
 *
 * Storage is whatever `ProcessStorage.layer` composes ({@link LogStore} rides `RuntimeStorage` —
 * memory / sqlite / redis). It's opt-in: without `persistLayer`, logs are the in-memory tail only.
 *
 * ```ts
 * const NodeLive = myNode.pipe(
 *   Effect.provide(NodeLogs.layer),
 *   Effect.provide(NodeLogs.persistLayer("wnba")), // requires LogStore (ProcessStorage.layer)
 * );
 * // later, anywhere with LogStore in context:
 * const nodeLines = yield* NodeLogs.byNode("wnba", { limit: 200 });
 * const queueLines = yield* NodeLogs.byResource({ queueId: "BoxScoreQueue" });
 * ```
 *
 * @module NodeLogs
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
 * A captured node log line — the element of {@link stream}. (Alias of the package's structured log
 * entry; the neutral name is the public face.)
 *
 * @public
 */
export type NodeLogEntry = LogEntry;

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
export const snapshot: Effect.Effect<ReadonlyArray<NodeLogEntry>, never, LogRelay> = Effect.flatMap(
  LogRelay,
  (relay) => relay.snapshot,
);

/**
 * The live node log stream: the recent tail replayed first, then live lines. Requires {@link layer}.
 *
 * @public
 */
export const stream: Stream.Stream<NodeLogEntry, never, LogRelay> = Stream.unwrap(
  Effect.gen(function* () {
    const relay = yield* LogRelay;
    const tail = yield* relay.snapshot;
    return Stream.concat(Stream.fromIterable(tail), relay.stream);
  }),
);

/**
 * Durably store this node's logs: forks a **batched** writer that appends every captured line to
 * {@link LogStore}, **bucketed by `node`**, stamping each line with the `node` annotation while
 * preserving its `processId` / `queueId`. Requires {@link layer} (for the relay) and a `LogStore`
 * (compose `ProcessStorage.layer` + a backend). The forked writer lives for the layer's scope.
 *
 * @public
 */
export const persistLayer = (node: string): Layer.Layer<never, never, LogStore> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const store = yield* LogStore;
      // a durable buffer created at layer-build: the logger below offers into it (synchronously, from
      // the moment it's installed — no subscription race), a forked writer batches out of it.
      const queue = yield* Queue.unbounded<NodeLogEntry>();
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
                  annotations: { ...entry.annotations, [LogAnnotationKeys.node]: node },
                },
              }));
              return yield* store.recordBatch(node, rows).pipe(Effect.orDie);
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
): Effect.Effect<ReadonlyArray<NodeLogEntry>, never, LogStore> =>
  Effect.flatMap(LogStore, (store) => store.load(query)).pipe(
    // an empty match is `[]`, not an error, for a query API
    Effect.catchIf(
      (error): error is LogQueryError => error instanceof LogQueryError,
      () => Effect.succeed<ReadonlyArray<NodeLogEntry>>([]),
    ),
    // a storage failure (backend down) is a defect for a best-effort log read
    Effect.orDie,
  );

/** Options shared by {@link byNode} / {@link byResource}. @public */
export interface LogReadOptions {
  readonly limit?: number;
  readonly sort?: LogSort;
  readonly from?: Date;
  readonly to?: Date;
}

/**
 * Read the durable logs for a **whole node** (every resource on it), newest first. Requires
 * {@link LogStore}; returns `[]` if none match.
 *
 * @public
 */
export const byNode = (
  node: string,
  options?: LogReadOptions,
): Effect.Effect<ReadonlyArray<NodeLogEntry>, never, LogStore> =>
  runQuery({
    groupId: node,
    limit: options?.limit ?? queryLimitDefault,
    sort: options?.sort ?? "desc",
    ...(options?.from === undefined ? {} : { from: options.from }),
    ...(options?.to === undefined ? {} : { to: options.to }),
  });

/**
 * Read the durable logs for a **specific resource** (a queue/process, across nodes), newest first.
 * Requires {@link LogStore}; returns `[]` if none match.
 *
 * @public
 */
export const byResource = (
  resource: { readonly processId?: string; readonly queueId?: string },
  options?: LogReadOptions,
): Effect.Effect<ReadonlyArray<NodeLogEntry>, never, LogStore> =>
  runQuery({
    ...(resource.processId === undefined ? {} : { processId: resource.processId }),
    ...(resource.queueId === undefined ? {} : { queueId: resource.queueId }),
    limit: options?.limit ?? queryLimitDefault,
    sort: options?.sort ?? "desc",
    ...(options?.from === undefined ? {} : { from: options.from }),
    ...(options?.to === undefined ? {} : { to: options.to }),
  });

/**
 * Node logs — runtime-wide capture + live stream + durable, node/resource-queryable storage.
 * See the {@link NodeLogs | module docs}.
 *
 * @public
 */
export const NodeLogs = {
  layer,
  stream,
  snapshot,
  persistLayer,
  byNode,
  byResource,
  /** The backing relay service (provided by {@link layer}). */
  Relay: LogRelay,
} as const;

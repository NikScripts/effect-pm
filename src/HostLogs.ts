/**
 * **Host logs** — capture and stream **every** log emitted in a runtime, including
 * resources that aren't tagged and bare `Effect.log*` calls.
 *
 * @remarks
 * This is the runtime-wide complement to the per-resource `logs` stream on
 * `QueueResource` / the toolkit `Resource`: rather than scoping capture to one
 * resource's worker fibers, `HostLogs.layer` installs a **merged** capture logger
 * over the whole runtime and fans every structured {@link HostLogEntry} into a
 * sliding relay you can `stream`.
 *
 * - **Merged** (`mergeWithExisting: true`): your existing console / app loggers
 *   keep running — Host logs *adds* capture, it doesn't replace your logging.
 * - **Runtime-wide:** any `Effect.log*` anywhere under the provided layer is
 *   captured, with its level, message, cause, annotations and spans intact (one
 *   {@link HostLogEntry} schema, shared with the per-resource capture).
 * - **Late subscribers** get the relay's recent tail (via {@link snapshot}) before
 *   live lines — the same log-tail UX as the queue's `logs`.
 *
 * ```ts
 * const program = myApp.pipe(Effect.provide(HostLogs.layer));
 * // elsewhere, with HostLogs.layer in context:
 * yield* HostLogs.stream.pipe(Stream.runForEach((line) => render(line)), Effect.forkScoped);
 * ```
 *
 * It reuses the package's capture-relay infrastructure ({@link Logs}, `LogRelay`,
 * `LogEntry`); `HostLogs` is the runtime-wide, first-class face of that machinery.
 *
 * @module HostLogs
 */
import { Effect, Layer, Logger, Option, Schema, Stream } from "effect";
import {
  LogRelay,
  captureLogger,
  relayOnlyLayer,
} from "./Logs";
import type { LogEntry } from "./LogEntry";
import { LogEntrySchema } from "./LogEntry";
import { HistoryStore } from "./HistoryStore";
import type { HistoryReadOptions } from "./HistoryStore";

/** The HistoryStore stream id under which runtime-wide host logs are persisted. */
const HOST_LOGS_STREAM_ID = "hostlogs";

/**
 * A captured host log line — the element of {@link stream}. (Alias of the
 * package's structured log entry; the neutral name is the public face.)
 *
 * @public
 */
export type HostLogEntry = LogEntry;

/**
 * Install runtime-wide log capture: a sliding relay plus a **merged** capture
 * logger that publishes every log line to it. Provide this at your app root; then
 * read {@link stream} / {@link snapshot} (they require the relay this layer
 * provides). Merged, so it never silences your existing loggers.
 *
 * @public
 */
export const layer: Layer.Layer<LogRelay> = Layer.merge(
  relayOnlyLayer,
  Logger.layer([captureLogger], { mergeWithExisting: true }),
);

/**
 * The recent captured tail (bounded), read once. Useful for a first paint, or for
 * composing your own replay; {@link stream} already prepends it.
 *
 * @public
 */
export const snapshot: Effect.Effect<
  ReadonlyArray<HostLogEntry>,
  never,
  LogRelay
> = Effect.flatMap(LogRelay, (relay) => relay.snapshot);

/**
 * The live host log stream: the recent tail replayed first (so a late subscriber
 * isn't blind to what just happened), then live lines. Requires {@link layer}.
 *
 * @public
 */
export const stream: Stream.Stream<HostLogEntry, never, LogRelay> =
  Stream.unwrap(
    Effect.gen(function* () {
      const relay = yield* LogRelay;
      const tail = yield* relay.snapshot;
      return Stream.concat(Stream.fromIterable(tail), relay.stream);
    }),
  );

/**
 * Persist runtime-wide logs: forks a fiber that appends every live log line to a
 * {@link HistoryStore} (keyed `"hostlogs"`), so {@link history} can read them back beyond the
 * relay's in-memory tail. Provide it alongside {@link layer} **and** a `HistoryStore` layer; the
 * forked tap lives for the layer's scope. Opt-in — without it, nothing is persisted.
 *
 * @public
 */
export const persistLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const relay = yield* LogRelay;
    const store = yield* HistoryStore;
    yield* Effect.forkScoped(
      Stream.runForEach(relay.stream, (entry) =>
        Schema.encodeEffect(LogEntrySchema)(entry).pipe(
          Effect.flatMap((encoded) => store.append(HOST_LOGS_STREAM_ID, encoded)),
          Effect.orDie,
        ),
      ),
    );
  }),
);

/**
 * Read back persisted host logs (newest `limit` within `since`/`until`). Optional via
 * `serviceOption(HistoryStore)` — returns `[]` when no `HistoryStore` is provided.
 *
 * @public
 */
export const history = (
  options?: HistoryReadOptions,
): Effect.Effect<ReadonlyArray<HostLogEntry>> =>
  Effect.serviceOption(HistoryStore).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed<ReadonlyArray<HostLogEntry>>([]),
        onSome: (store) =>
          store.read(HOST_LOGS_STREAM_ID, options).pipe(
            Effect.flatMap((rows) =>
              Effect.forEach(rows, (row) =>
                Schema.decodeUnknownEffect(LogEntrySchema)(row).pipe(
                  Effect.orDie,
                ),
              ),
            ),
          ),
      }),
    ),
  );

/**
 * Host logs — runtime-wide log capture + stream (everything, including untagged
 * resources). See the {@link HostLogs | module docs}.
 *
 * @public
 */
export const HostLogs = {
  layer,
  stream,
  snapshot,
  persistLayer,
  history,
  /** The backing relay service (provided by {@link layer}). */
  Relay: LogRelay,
} as const;

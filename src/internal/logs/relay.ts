/**
 * In-process log relay — bounded tail + PubSub bus for live watch.
 *
 * @module internal/logs/relay
 * @internal
 */

import { Context, Effect, Layer, Logger, Option, PubSub, Ref, Stream } from "effect";
import * as LogLevel from "effect/LogLevel";
import { CurrentLogAnnotations, CurrentLogSpans } from "effect/References";
import { LogAnnotationKeys } from "../../LogContext";
import {
  logEntryFromLoggerOptions,
  type LogEntry,
} from "../../LogEntry";

const historyCapacity = 500;

const stampLineId = (entry: LogEntry, lineId: string): LogEntry => {
  if (entry.annotations[LogAnnotationKeys.lineId] !== undefined) {
    return entry;
  }
  return {
    ...entry,
    annotations: {
      ...entry.annotations,
      [LogAnnotationKeys.lineId]: lineId,
    },
  };
};

/** @internal */
export interface LogRelayService {
  readonly publish: (entry: LogEntry) => Effect.Effect<void>;
  readonly snapshot: Effect.Effect<ReadonlyArray<LogEntry>>;
  readonly stream: Stream.Stream<LogEntry>;
}

/** @internal */
export class LogRelay extends Context.Service<LogRelay, LogRelayService>()(
  "@nikscripts/effect-pm/internal/logs/relay/LogRelay",
) {}

const pushHistory = (
  history: Ref.Ref<ReadonlyArray<LogEntry>>,
  entry: LogEntry,
): Effect.Effect<void> =>
  Ref.update(history, (items) => {
    const next = [...items, entry];
    return next.length <= historyCapacity
      ? next
      : next.slice(next.length - historyCapacity);
  });

/** Relay layer: PubSub + bounded in-memory tail. @internal */
export const relayLayer = Layer.effect(
  LogRelay,
  Effect.gen(function* () {
    const pubsub = yield* PubSub.unbounded<LogEntry>();
    const history = yield* Ref.make<ReadonlyArray<LogEntry>>([]);
    const nextLineId = yield* Ref.make(0);

    return LogRelay.of({
      publish: (entry) =>
        Effect.gen(function* () {
          const id = yield* Ref.getAndUpdate(nextLineId, (n) => n + 1);
          const stamped = stampLineId(entry, String(id));
          yield* PubSub.publish(pubsub, stamped);
          yield* pushHistory(history, stamped);
        }),
      snapshot: Ref.get(history),
      stream: Stream.fromPubSub(pubsub),
    });
  }),
);

/**
 * Build a capture {@link Logger} closed over a concrete {@link LogRelay}.
 *
 * Closing over the relay (instead of reading it from `fiber.context` at log time) means
 * worker fibers forked during layer acquisition still publish — they may not carry
 * {@link LogRelay} in context even when the node root installed capture.
 *
 * @internal
 */
export const makeCaptureLogger = (
  relay: LogRelayService,
): Logger.Logger<unknown, void> =>
  Logger.make((options) => {
    const entry = logEntryFromLoggerOptions({
      message: options.message,
      logLevel: options.logLevel,
      cause: options.cause,
      date: options.date,
      annotations: options.fiber.getRef(CurrentLogAnnotations),
      spans: options.fiber.getRef(CurrentLogSpans),
    });
    const context = Context.add(options.fiber.context, LogRelay, relay);
    options.fiber.currentDispatcher.scheduleTask(
      () => {
        Effect.runForkWith(context)(relay.publish(entry));
      },
      0,
    );
  });

/**
 * @deprecated Prefer {@link layer} / {@link makeCaptureLogger}. Fiber-context lookup misses
 * queue workers forked during layer acquisition before {@link LogRelay} is on that fiber.
 *
 * @internal
 */
export const captureLogger: Logger.Logger<unknown, void> = Logger.make((options) => {
  const relayOption = Context.getOption(LogRelay)(options.fiber.context);
  if (Option.isNone(relayOption)) {
    return;
  }
  makeCaptureLogger(relayOption.value).log(options);
});

/**
 * Merged capture logger layer — requires {@link LogRelay} and closes the logger over it.
 *
 * @internal
 */
export const captureLoggerLayer: Layer.Layer<never, never, LogRelay> = Layer.unwrap(
  Effect.map(LogRelay, (relay) =>
    Logger.layer([makeCaptureLogger(relay)], { mergeWithExisting: true }),
  ),
);

/** Node root: relay + one merged capture logger. @internal */
export const layer = captureLoggerLayer.pipe(Layer.provideMerge(relayLayer));

const logAtLevel = (level: LogLevel.LogLevel, message: string): Effect.Effect<void> => {
  switch (level) {
    case "Fatal":
      return Effect.logFatal(message);
    case "Error":
      return Effect.logError(message);
    case "Warn":
      return Effect.logWarning(message);
    case "Debug":
      return Effect.logDebug(message);
    case "Trace":
      return Effect.logTrace(message);
    case "Info":
    case "All":
    case "None":
      return Effect.logInfo(message);
  }
};

const annotateLogsFromEntry = (
  program: Effect.Effect<void>,
  annotations: Readonly<Record<string, string>>,
): Effect.Effect<void> => {
  let next = program;
  for (const [key, value] of Object.entries(annotations)) {
    next = Effect.annotateLogs(key, value)(next);
  }
  return next;
};

const withSpansFromEntry = (
  program: Effect.Effect<void>,
  spans: ReadonlyArray<string>,
): Effect.Effect<void> => {
  let next = program;
  for (const span of spans) {
    next = Effect.withLogSpan(span)(next);
  }
  return next;
};

/** Replay one captured entry through the ambient Effect logger. @internal */
export const replayLogEntry = (entry: LogEntry): Effect.Effect<void> => {
  let program = logAtLevel(entry.level, entry.message);
  program = annotateLogsFromEntry(program, entry.annotations);
  program = withSpansFromEntry(program, entry.spans);
  if (entry.cause !== undefined) {
    program = Effect.annotateLogs("relayCause", entry.cause)(program);
  }
  return program;
};

/** Unfiltered live bus: snapshot prefix + PubSub stream. @internal */
export const stream: Stream.Stream<LogEntry, never, LogRelay> = Stream.unwrap(
  Effect.gen(function* () {
    const relay = yield* LogRelay;
    const tail = yield* relay.snapshot;
    return Stream.concat(Stream.fromIterable(tail), relay.stream);
  }),
);

/** Bounded tail read. @internal */
export const snapshot: Effect.Effect<ReadonlyArray<LogEntry>, never, LogRelay> = Effect.flatMap(
  LogRelay,
  (relay) => relay.snapshot,
);

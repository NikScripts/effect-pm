/**
 * In-process log relay — bounded tail + PubSub bus for live watch.
 *
 * @module internal/logs/relay
 * @internal
 */

import { Context, Effect, Layer, Logger, Option, PubSub, Ref, Stream } from "effect";
import * as LogLevel from "effect/LogLevel";
import { CurrentLogAnnotations, CurrentLogSpans } from "effect/References";
import {
  logEntryFromLoggerOptions,
  type LogEntry,
} from "../../LogEntry";

const historyCapacity = 500;

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

    return LogRelay.of({
      publish: (entry) =>
        Effect.gen(function* () {
          yield* PubSub.publish(pubsub, entry);
          yield* pushHistory(history, entry);
        }),
      snapshot: Ref.get(history),
      stream: Stream.fromPubSub(pubsub),
    });
  }),
);

/**
 * Logger that captures {@link LogEntry} values into {@link LogRelay}.
 *
 * @internal
 */
export const captureLogger: Logger.Logger<unknown, void> = Logger.make((options) => {
  const relayOption = Context.getOption(LogRelay)(options.fiber.context);
  if (Option.isNone(relayOption)) {
    return;
  }
  const relay = relayOption.value;
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

/** Merged capture logger layer (requires {@link LogRelay}). @internal */
export const captureLoggerLayer = Logger.layer([captureLogger], {
  mergeWithExisting: true,
});

/** Node root: relay + one merged capture logger. @internal */
export const layer = Layer.merge(relayLayer, captureLoggerLayer);

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

import { Context, Effect, Layer, Logger, Option, PubSub, Ref, Stream } from "effect";
import * as LogLevel from "effect/LogLevel";
import { CurrentLogAnnotations, CurrentLogSpans } from "effect/References";
import {
  logEntryFromLoggerOptions,
  type LogEntry,
} from "../../LogEntry";

const historyCapacity = 500;

/**
 * In-process relay for structured group log events (child runtime).
 *
 * @public
 */
export interface LogRelayService {
  readonly publish: (
    entry: LogEntry,
  ) => Effect.Effect<void>;
  readonly snapshot: Effect.Effect<ReadonlyArray<LogEntry>>;
  readonly stream: Stream.Stream<LogEntry>;
}

/**
 * @public
 */
export class LogRelay extends Context.Service<
  LogRelay,
  LogRelayService
>()("@nikscripts/effect-pm/internal/manager/logCapture/LogRelay") {}

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

/**
 * Scoped layer: PubSub stream plus in-memory tail history for non-follow clients.
 *
 * @public
 */
export const layer = Layer.effect(
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
 * Logger that captures pure {@link LogEntry} values into {@link LogRelay}.
 *
 * @remarks
 * Effect v4 invokes `log` synchronously and does not run effect-returning loggers.
 * Publish is scheduled on the logging fiber's dispatcher with its context.
 *
 * @public
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

/**
 * Install capture-only logging in the child process (no local console formatting).
 *
 * @public
 */
export const captureLoggerLayer = Logger.layer(
  [captureLogger],
  { mergeWithExisting: false },
) satisfies Layer.Layer<never, never, LogRelay>;

const logAtLevel = (
  level: LogLevel.LogLevel,
  message: string,
): Effect.Effect<void> => {
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

/**
 * Replay one captured entry through the ambient Effect logger (PM operator).
 *
 * @public
 */
export const replayLogEntry = (
  entry: LogEntry,
): Effect.Effect<void> => {
  let program = logAtLevel(entry.level, entry.message);
  program = annotateLogsFromEntry(program, entry.annotations);
  program = withSpansFromEntry(program, entry.spans);
  if (entry.cause !== undefined) {
    program = Effect.annotateLogs("relayCause", entry.cause)(program);
  }
  return program;
};

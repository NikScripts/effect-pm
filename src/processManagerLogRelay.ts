import { Context, Effect, Layer, Logger, Option, PubSub, Ref, Stream } from "effect";
import * as LogLevel from "effect/LogLevel";
import { CurrentLogAnnotations, CurrentLogSpans } from "effect/References";
import {
  processManagerLogEntryFromLoggerOptions,
  type ProcessManagerLogEntry,
} from "./processManagerLogEntry.js";

const historyCapacity = 500;

/**
 * In-process relay for structured group log events (child runtime).
 *
 * @public
 */
export interface ProcessManagerLogRelayService {
  readonly publish: (
    entry: ProcessManagerLogEntry,
  ) => Effect.Effect<void>;
  readonly snapshot: Effect.Effect<ReadonlyArray<ProcessManagerLogEntry>>;
  readonly stream: Stream.Stream<ProcessManagerLogEntry>;
}

/**
 * @public
 */
export class ProcessManagerLogRelay extends Context.Service<
  ProcessManagerLogRelay,
  ProcessManagerLogRelayService
>()("@nikscripts/effect-pm/processManagerLogRelay") {}

const pushHistory = (
  history: Ref.Ref<ReadonlyArray<ProcessManagerLogEntry>>,
  entry: ProcessManagerLogEntry,
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
  ProcessManagerLogRelay,
  Effect.gen(function* () {
    const pubsub = yield* PubSub.unbounded<ProcessManagerLogEntry>();
    const history = yield* Ref.make<ReadonlyArray<ProcessManagerLogEntry>>([]);

    return ProcessManagerLogRelay.of({
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
 * Logger that captures pure {@link ProcessManagerLogEntry} values into {@link ProcessManagerLogRelay}.
 *
 * @remarks
 * Effect v4 invokes `log` synchronously and does not run effect-returning loggers.
 * Publish is scheduled on the logging fiber's dispatcher with its context.
 *
 * @public
 */
export const captureLogger: Logger.Logger<unknown, void> = Logger.make((options) => {
  const relayOption = Context.getOption(ProcessManagerLogRelay)(options.fiber.context);
  if (Option.isNone(relayOption)) {
    return;
  }
  const relay = relayOption.value;
  const entry = processManagerLogEntryFromLoggerOptions({
    message: options.message,
    logLevel: options.logLevel,
    cause: options.cause,
    date: options.date,
    annotations: options.fiber.getRef(CurrentLogAnnotations),
    spans: options.fiber.getRef(CurrentLogSpans),
  });
  const context = Context.add(options.fiber.context, ProcessManagerLogRelay, relay);
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
export const captureLoggerLayer: Layer.Layer<never> = Logger.layer(
  [captureLogger],
  { mergeWithExisting: false },
);

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
  entry: ProcessManagerLogEntry,
): Effect.Effect<void> => {
  let program = logAtLevel(entry.level, entry.message);
  program = annotateLogsFromEntry(program, entry.annotations);
  program = withSpansFromEntry(program, entry.spans);
  if (entry.cause !== undefined) {
    program = Effect.annotateLogs("relayCause", entry.cause)(program);
  }
  return program;
};

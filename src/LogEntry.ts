import { Cause, Effect, Schema } from "effect";
import type { LogLevel } from "effect/LogLevel";

const logLevelSchema = Schema.Literals([
  "All",
  "Fatal",
  "Error",
  "Warn",
  "Info",
  "Debug",
  "Trace",
  "None",
] as const);

/**
 * Serializable log event captured from an Effect {@link Logger} invocation.
 *
 * @public
 */
export interface LogEntry {
  readonly date: string;
  readonly level: LogLevel;
  readonly message: string;
  readonly cause?: string;
  readonly annotations: Readonly<Record<string, string>>;
  readonly spans: ReadonlyArray<string>;
}

/**
 * @public
 */
export const LogEntrySchema = Schema.Struct({
  date: Schema.String,
  level: logLevelSchema,
  message: Schema.String,
  cause: Schema.optional(Schema.String),
  annotations: Schema.Record(Schema.String, Schema.String),
  spans: Schema.Array(Schema.String),
});

const LogEntryNdjson = Schema.fromJsonString(LogEntrySchema);

/**
 * @public
 */
export const encodeLogEntryNdjson = (
  entry: LogEntry,
): Effect.Effect<string, Schema.SchemaError> =>
  Schema.encodeEffect(LogEntryNdjson)(entry);

/**
 * @public
 */
export const decodeLogEntryNdjson = (
  line: string,
): Effect.Effect<LogEntry, Schema.SchemaError> =>
  Schema.decodeUnknownEffect(LogEntryNdjson)(line);

const encodeAnnotationValue = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const encodeMessage = (message: unknown): string => {
  if (Array.isArray(message)) {
    if (message.length === 1) {
      return encodeMessage(message[0]);
    }
    return message.map((part) => encodeMessage(part)).join(" ");
  }
  if (typeof message === "string") {
    return message;
  }
  try {
    return JSON.stringify(message);
  } catch {
    return String(message);
  }
};

/**
 * Build a {@link LogEntry} from runtime logger options and fiber log context.
 *
 * @public
 */
export const logEntryFromLoggerOptions = (options: {
  readonly message: unknown;
  readonly logLevel: LogLevel;
  readonly cause: Cause.Cause<unknown>;
  readonly date: Date;
  readonly annotations: Readonly<Record<string, unknown>>;
  readonly spans: ReadonlyArray<readonly [label: string, startTime: number]>;
}): LogEntry => ({
  date: options.date.toISOString(),
  level: options.logLevel,
  message: encodeMessage(options.message),
  ...(options.cause.reasons.length === 0
    ? {}
    : { cause: Cause.pretty(options.cause) }),
  annotations: Object.fromEntries(
    Object.entries(options.annotations).map(([key, value]) => [
      key,
      encodeAnnotationValue(value),
    ]),
  ),
  spans: options.spans.map(([label]) => label),
});

/**
 * NDJSON log entry wire format for process-manager capture — the `LogEntry.Schema` /
 * `LogEntry.encode` / `LogEntry.decode` / `LogEntry.fromLoggerOptions` namespace members,
 * exposed as flat aliases so `import * as LogEntry` and the root re-exports stay identical.
 *
 * @public
 */
export {
  LogEntrySchema as Schema,
  encodeLogEntryNdjson as encode,
  decodeLogEntryNdjson as decode,
  logEntryFromLoggerOptions as fromLoggerOptions,
};

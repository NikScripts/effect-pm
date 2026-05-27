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
export interface ProcessManagerLogEntry {
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
export const ProcessManagerLogEntrySchema = Schema.Struct({
  date: Schema.String,
  level: logLevelSchema,
  message: Schema.String,
  cause: Schema.optional(Schema.String),
  annotations: Schema.Record(Schema.String, Schema.String),
  spans: Schema.Array(Schema.String),
});

const ProcessManagerLogEntryNdjson = Schema.fromJsonString(ProcessManagerLogEntrySchema);

/**
 * @public
 */
export const encodeProcessManagerLogEntryNdjson = (
  entry: ProcessManagerLogEntry,
): Effect.Effect<string, Schema.SchemaError> =>
  Schema.encodeEffect(ProcessManagerLogEntryNdjson)(entry);

/**
 * @public
 */
export const decodeProcessManagerLogEntryNdjson = (
  line: string,
): Effect.Effect<ProcessManagerLogEntry, Schema.SchemaError> =>
  Schema.decodeUnknownEffect(ProcessManagerLogEntryNdjson)(line);

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
 * Build a {@link ProcessManagerLogEntry} from runtime logger options and fiber log context.
 *
 * @public
 */
export const processManagerLogEntryFromLoggerOptions = (options: {
  readonly message: unknown;
  readonly logLevel: LogLevel;
  readonly cause: Cause.Cause<unknown>;
  readonly date: Date;
  readonly annotations: Readonly<Record<string, unknown>>;
  readonly spans: ReadonlyArray<readonly [label: string, startTime: number]>;
}): ProcessManagerLogEntry => ({
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
 * NDJSON log entry wire format for process-manager capture.
 *
 * @public
 */
export const LogEntry = {
  Schema: ProcessManagerLogEntrySchema,
  encode: encodeProcessManagerLogEntryNdjson,
  decode: decodeProcessManagerLogEntryNdjson,
  fromLoggerOptions: processManagerLogEntryFromLoggerOptions,
} as const;

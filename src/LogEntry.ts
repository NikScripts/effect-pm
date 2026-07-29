import { Cause, Effect, Schema } from "effect";
import type { Predicate } from "effect";
import type { LogLevel } from "effect/LogLevel";
import { LogAnnotationKeys } from "./LogContext";

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
 * @category models
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
 * @category wire schemas
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
 * @category wire schemas
 * @public
 */
export const encodeLogEntryNdjson = (
  entry: LogEntry,
): Effect.Effect<string, Schema.SchemaError> =>
  Schema.encodeEffect(LogEntryNdjson)(entry);

/**
 * @category wire schemas
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
 * @category wire schemas
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

const parseLineageJson = (raw: string | undefined): ReadonlyArray<string> => {
  if (raw === undefined) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed;
    }
  } catch {
    // ignore malformed lineage
  }
  return [];
};

/**
 * Decode **lineage segment keys** from a captured entry's annotations.
 *
 * Reads annotation key {@link LogAnnotationKeys.lineage} only (JSON array of `Tag.key` segments).
 *
 * @category getters
 * @public
 */
export const lineage = (entry: LogEntry): ReadonlyArray<string> =>
  parseLineageJson(entry.annotations[LogAnnotationKeys.lineage]);

/**
 * `true` when the **lineage segment key** appears anywhere in {@link lineage}.
 *
 * @param key - Usually a **hyperlink key** (`Tag.key`, e.g. `wnba/LiveScorePoller` in `apps/web/hub.ts`).
 *
 * @category guards
 * @public
 */
export const hasKey = (key: string): Predicate.Predicate<LogEntry> => (entry) =>
  lineage(entry).includes(key);

/**
 * `true` when `lineage[0]` equals the **lineage segment key** (usually the **node log key**).
 *
 * @param key - **Node log key** (`Node.key`, e.g. `wnba/live` from `LiveNode.key`).
 *
 * @category guards
 * @public
 */
export const atRoot = (key: string): Predicate.Predicate<LogEntry> => (entry) =>
  lineage(entry)[0] === key;

/**
 * `true` when the last lineage segment equals the **lineage segment key** (usually the **hyperlink key**).
 *
 * @param key - **Hyperlink key** (`Tag.key`, e.g. `wnba/LiveScorePoller`).
 *
 * @category guards
 * @public
 */
export const atLeaf = (key: string): Predicate.Predicate<LogEntry> => (entry) => {
  const segments = lineage(entry);
  return segments[segments.length - 1] === key;
};

/**
 * NDJSON log entry wire format for hyperlink-ts capture — the `LogEntry.Schema` /
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

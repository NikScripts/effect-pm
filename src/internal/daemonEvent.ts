/**
 * Wire schemas for daemon execution store events.
 *
 * @module internal/daemonEvent
 * @internal
 */

import { Schema } from "effect";

const daemonFinishedBase = {
  key: Schema.String,
  scheduleKey: Schema.NullOr(Schema.String),
  startedAt: Schema.Number,
  completedAt: Schema.Number,
  durationMs: Schema.Number,
  isStartupRun: Schema.Boolean,
} as const;

const runStartedFields = {
  key: Schema.String,
  scheduleKey: Schema.NullOr(Schema.String),
  startedAt: Schema.Number,
  isStartupRun: Schema.Boolean,
} as const;

/**
 * Build the execution event union for a daemon store contract.
 *
 * Includes `Started` at run begin and terminal variants at finish. When `success` is set,
 * `Completed` carries an optional `success` value. When `error` is set, `Failed.error` uses
 * that schema; otherwise `Schema.String`.
 *
 * @internal
 */
export const makeDaemonExecutionEvent = <
  Success extends Schema.Top | void = void,
  Error extends Schema.Top | void = void,
>(
  success?: Success extends Schema.Top ? Success : never,
  error?: Error extends Schema.Top ? Error : never,
) => {
  const completedFields =
    success === undefined
      ? daemonFinishedBase
      : { ...daemonFinishedBase, success: Schema.optional(success) };

  const failedFields = {
    ...daemonFinishedBase,
    error: error === undefined ? Schema.String : error,
  };

  return Schema.Union([
    Schema.TaggedStruct("Started", runStartedFields),
    Schema.TaggedStruct("Completed", completedFields),
    Schema.TaggedStruct("Failed", failedFields),
    Schema.TaggedStruct("Interrupted", daemonFinishedBase),
  ]);
};

/** Void-daemon execution events (no `result` field). @internal */
export const daemonExecutionEventVoid = makeDaemonExecutionEvent();

/** Execution event type for a void daemon. @internal */
export type DaemonExecutionEventVoid = typeof daemonExecutionEventVoid.Type;

/** Execution event type parameterized by optional success / error schemas. @internal */
export type DaemonExecutionEvent<
  Success extends Schema.Top | void = void,
  Error extends Schema.Top | void = void,
> = ReturnType<
  typeof makeDaemonExecutionEvent<
    Success extends Schema.Top ? Success : void,
    Error extends Schema.Top ? Error : void
  >
>["Type"];

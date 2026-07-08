/**
 * Wire schemas for process execution store events.
 *
 * @module internal/processEvent
 * @internal
 */

import { Schema } from "effect";

/** Read payload for the built-in `events` query. @internal */
export const processEventReadPayload = Schema.Struct({
  limit: Schema.optional(Schema.Number),
});

const runFinishedBase = {
  processId: Schema.String,
  scheduleKey: Schema.NullOr(Schema.String),
  startedAt: Schema.Number,
  completedAt: Schema.Number,
  durationMs: Schema.Number,
  isStartupRun: Schema.Boolean,
} as const;

const runStartedFields = {
  processId: Schema.String,
  scheduleKey: Schema.NullOr(Schema.String),
  startedAt: Schema.Number,
  isStartupRun: Schema.Boolean,
} as const;

/**
 * Build the execution event union for a process store contract.
 *
 * Includes `RunStarted` at run begin and terminal variants at finish. When `success` is set,
 * `RunCompleted` carries an optional `success` value. When `error` is set, `RunFailed.error` uses
 * that schema; otherwise `Schema.String`.
 *
 * @internal
 */
export const makeProcessExecutionEvent = <
  Success extends Schema.Top | void = void,
  Error extends Schema.Top | void = void,
>(
  success?: Success extends Schema.Top ? Success : never,
  error?: Error extends Schema.Top ? Error : never,
) => {
  const completedFields =
    success === undefined
      ? runFinishedBase
      : { ...runFinishedBase, success: Schema.optional(success) };

  const failedFields = {
    ...runFinishedBase,
    error: error === undefined ? Schema.String : error,
  };

  return Schema.Union([
    Schema.TaggedStruct("RunStarted", runStartedFields),
    Schema.TaggedStruct("RunCompleted", completedFields),
    Schema.TaggedStruct("RunFailed", failedFields),
    Schema.TaggedStruct("RunInterrupted", runFinishedBase),
  ]);
};

/** Void-process execution events (no `result` field). @internal */
export const processExecutionEventVoid = makeProcessExecutionEvent();

/** Execution event type for a void process. @internal */
export type ProcessExecutionEventVoid = typeof processExecutionEventVoid.Type;

/** Execution event type parameterized by optional success / error schemas. @internal */
export type ProcessExecutionEvent<
  Success extends Schema.Top | void = void,
  Error extends Schema.Top | void = void,
> = ReturnType<
  typeof makeProcessExecutionEvent<
    Success extends Schema.Top ? Success : void,
    Error extends Schema.Top ? Error : void
  >
>["Type"];

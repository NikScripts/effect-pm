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

/**
 * Build the execution event union for a process store contract.
 * When `success` is set, `RunCompleted` carries an optional encoded `result`.
 *
 * @internal
 */
export const makeProcessExecutionEvent = <R extends Schema.Top>(
  success?: R,
) => {
  const completedFields =
    success === undefined
      ? runFinishedBase
      : { ...runFinishedBase, result: Schema.optional(success) };

  return Schema.Union([
    Schema.TaggedStruct("RunCompleted", completedFields),
    Schema.TaggedStruct("RunFailed", {
      ...runFinishedBase,
      error: Schema.String,
    }),
    Schema.TaggedStruct("RunInterrupted", runFinishedBase),
  ]);
};

/** Void-process execution events (no `result` field). @internal */
export const processExecutionEventVoid = makeProcessExecutionEvent();

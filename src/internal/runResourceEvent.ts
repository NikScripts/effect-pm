/**
 * Wire schemas for RunResource store facts.
 *
 * @module internal/runResourceEvent
 * @internal
 */

import { Schema } from "effect";

/** Read payload for the built-in `facts` query. @internal */
export const runFactReadPayload = Schema.Struct({
  limit: Schema.optional(Schema.Number),
  runId: Schema.optional(Schema.String),
});

const runFinishedBase = {
  id: Schema.String,
  resourceId: Schema.String,
  runId: Schema.String,
  occurredAt: Schema.Number,
  durationMs: Schema.Number,
} as const;

/**
 * Build the run fact union for a store contract — same terminal `_tag` names as
 * {@link QueueResource} worker events (`Started`, `Completed`, `Failed`).
 *
 * @internal
 */
export const makeRunResourceFactEvent = <
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
    Schema.TaggedStruct("Started", {
      id: Schema.String,
      resourceId: Schema.String,
      runId: Schema.String,
      occurredAt: Schema.Number,
      concurrency: Schema.Number,
    }),
    Schema.TaggedStruct("Completed", completedFields),
    Schema.TaggedStruct("Failed", failedFields),
  ]);
};

/** Void run facts (no `success`; string `error` fallback). @internal */
export const runResourceFactEventVoid = makeRunResourceFactEvent();

/** Run fact type for the default void contract. @internal */
export type RunResourceFactEventVoid = typeof runResourceFactEventVoid.Type;

/** Run fact type parameterized by optional success / error schemas. @internal */
export type RunResourceFactEvent<
  Success extends Schema.Top | void = void,
  Error extends Schema.Top | void = void,
> = ReturnType<
  typeof makeRunResourceFactEvent<
    Success extends Schema.Top ? Success : void,
    Error extends Schema.Top ? Error : void
  >
>["Type"];

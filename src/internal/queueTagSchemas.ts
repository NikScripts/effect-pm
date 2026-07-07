/**
 * Wire schemas stamped on {@link QueueResource.Tag} factories — the `success` / `error` slots.
 *
 * The `payload` slot is NOT stamped here: it is the queue's item schema, recovered from the tag's
 * `add` verb spec (see `queueStoreSpec.queueItemSchemaFromTag`). `success` (worker return) and
 * `error` (worker failure channel) have no spec verb of their own yet, so they ride as symbol stamps
 * that the engine + store contract read as the tag SSOT.
 *
 * @module internal/queueTagSchemas
 * @internal
 */

import { Schema } from "effect";

export const successSym: unique symbol = Symbol.for(
  "@nikscripts/effect-pm/Queue/success",
);

export const errorSym: unique symbol = Symbol.for(
  "@nikscripts/effect-pm/Queue/error",
);

/** Read the `success` schema stamped on a queue tag, if any. @internal */
export const successOf = (tag: unknown): Schema.Top | undefined => {
  if (
    (typeof tag === "object" || typeof tag === "function") &&
    tag !== null &&
    successSym in tag
  ) {
    const value = tag[successSym];
    return Schema.isSchema(value) ? value : undefined;
  }
  return undefined;
};

/** Read the `error` schema stamped on a queue tag, if any. @internal */
export const errorOf = (tag: unknown): Schema.Top | undefined => {
  if (
    (typeof tag === "object" || typeof tag === "function") &&
    tag !== null &&
    errorSym in tag
  ) {
    const value = tag[errorSym];
    return Schema.isSchema(value) ? value : undefined;
  }
  return undefined;
};

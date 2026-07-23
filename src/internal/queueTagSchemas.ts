/**
 * Wire schemas stamped on {@link WorkPool.Tag} factories — the `success` / `error` slots.
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
  "hyperlink-ts/Queue/success",
);

export const errorSym: unique symbol = Symbol.for(
  "hyperlink-ts/Queue/error",
);

export const itemSchemaSym: unique symbol = Symbol.for(
  "hyperlink-ts/Queue/itemSchema",
);

/**
 * Type-level marker: a queue tag carries its item schema (`payload`) under {@link itemSchemaSym}, so
 * the runtime verbs recover it **typed** without introspecting the runtime-flat spec. Required (every
 * queue tag has a payload), unlike the optional `success`/`error` phantom carriers. @internal
 */
export interface QueueItemSchemaCarrier<F extends Schema.Struct.Fields> {
  readonly [itemSchemaSym]: Schema.Struct<F>;
}

/**
 * Stamp the item schema (`payload`) onto a queue tag, typed. `Object.assign`'s `T & U` return carries
 * the {@link QueueItemSchemaCarrier} marker with no cast. @internal
 */
export const stampQueueItemSchema = <T extends object, F extends Schema.Struct.Fields>(
  tag: T,
  itemSchema: Schema.Struct<F>,
): T & QueueItemSchemaCarrier<F> =>
  Object.assign(tag, { [itemSchemaSym]: itemSchema });

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

/** Stamp `success` / `error` wire schemas onto a queue-family tag. @internal */
export const stampQueueWireSchemas = <T extends object>(
  tag: T,
  schemas: { readonly success?: Schema.Top; readonly error?: Schema.Top },
): T => {
  if (schemas.success !== undefined) {
    Object.assign(tag, { [successSym]: schemas.success });
  }
  if (schemas.error !== undefined) {
    Object.assign(tag, { [errorSym]: schemas.error });
  }
  return tag;
};

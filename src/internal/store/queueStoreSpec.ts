/**
 * Built-in {@link QueueResource} store spec — item schema injected from the queue tag.
 *
 * @remarks
 * Full facet parity (entries, lifecycle, dedupe, rate-limit) lands with the
 * `QueueResourceStore` migration. This stub wires the registration shape and item-schema
 * injection; method names are stable extension points.
 *
 * @module internal/store/queueStoreSpec
 * @internal
 */

import { Schema } from "effect";
import { specSym } from "../../Resource";
import type { StoreScopeTag } from "./registration";
import { storeAppend, storeQuery } from "./builders";

/** Queue tag shape for store registration — `specSym` carries the flat wire spec. @internal */
export interface QueueStoreTag extends StoreScopeTag {
  readonly [specSym]: Record<string, unknown>;
}

/** @internal */
export const queueItemSchemaFromTag = (
  tag: QueueStoreTag,
): Schema.Schema<unknown> => {
  const addMethod = tag[specSym].add as {
    readonly payload?: {
      readonly members?: ReadonlyArray<Schema.Schema<unknown>>;
    };
  };
  const itemSchema = addMethod.payload?.members?.[0];
  if (itemSchema === undefined) {
    throw new Error(`QueueResource.store: tag ${tag.key} has no item schema on spec.add`);
  }
  return itemSchema;
};

/**
 * Built-in queue store spec for a tag — item schema threaded into entry shapes.
 *
 * @internal
 */
export const builtInQueueStoreSpec = (tag: QueueStoreTag) => {
  const itemSchema = queueItemSchemaFromTag(tag);
  const entryFact = Schema.Struct({
    queueId: Schema.String,
    entryId: Schema.String,
    item: itemSchema,
  });

  return {
    recordEntry: storeAppend(entryFact),
    entries: storeQuery({
      from: "recordEntry",
      payload: Schema.Struct({
        limit: Schema.optional(Schema.Number),
      }),
      result: Schema.Array(entryFact),
    }),
  };
};

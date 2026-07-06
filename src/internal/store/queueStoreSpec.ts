/**
 * Built-in {@link QueueResource} store contract.
 *
 * The store persists the **same** `QueueEvent<T>` union the engine already publishes on the live
 * `.events` stream (one event model for wire + persistence — `queue-persistence-design.md`), using
 * the existing `queueEvent(itemSchema)` schema as the codec. So the handle is just `record` (append
 * a built event) + `events` (read them back) — no event model of its own, no object-literal
 * construction against a schema-decoded generic (which is what forced casts / collapsed hovers).
 *
 * @module internal/store/queueStoreSpec
 * @internal
 */

import { Schema } from "effect";
import type { Effect } from "effect";
import type { ResourceTag, Spec, SpecOf } from "../../Resource";
import { specSym } from "../../Resource";
import { queueEvent, queueSpec } from "../../QueueResource";
import type { QueueEvent } from "../queueResource";
import * as Store from "../../Store";
import type { StoreContractValue, StoreShapeDef } from "./contractDef";
import type { StoreScopeTag } from "./registration";

/** Queue tag shape for store registration — `specSym` carries the flat wire spec. @internal */
export interface QueueStoreTag extends StoreScopeTag {
  readonly [specSym]: Record<string, unknown>;
}

/** Spec of a queue instance whose item is `Schema.Struct<F>`. @internal */
type QueueInstanceSpec<F extends Schema.Struct.Fields> = ReturnType<typeof queueSpec<F>>;

/** Nested spec recovered from a queue tag class. @internal */
type QueueSpecFromTag<Tag extends QueueStoreTag> = SpecOf<Tag & ResourceTag<unknown, Spec>>;

/** Struct fields of the queue item from a tag. @internal */
type QueueItemFields<Tag extends QueueStoreTag> =
  QueueSpecFromTag<Tag> extends QueueInstanceSpec<infer F extends Schema.Struct.Fields> ? F : never;

/** Item row schema carried on a {@link QueueResource} tag (from `QueueInstanceSpec<F>`). @internal */
export type QueueItemSchemaFromTag<Tag extends QueueStoreTag> = Schema.Struct<QueueItemFields<Tag>>;

/** Item value type carried on a queue tag. @internal */
export type QueueItemOf<Tag extends QueueStoreTag> = Schema.Struct<QueueItemFields<Tag>>["Type"];

/** The persisted queue event for a tag — the same union the live `.events` stream carries. @internal */
export type QueueEventOf<Tag extends QueueStoreTag> = QueueEvent<QueueItemOf<Tag>>;

/** Read payload for the built-in `events` query. @internal */
export const queueEventReadPayload = Schema.Struct({
  limit: Schema.optional(Schema.Number),
});

/** Built-in queue store contract for a tag — one `event` shape over the shared event schema. @internal */
export type BuiltInQueueContract<Tag extends QueueStoreTag> = StoreContractValue<
  {
    readonly event: StoreShapeDef<
      ReturnType<typeof queueEvent<QueueItemSchemaFromTag<Tag>>>,
      typeof queueEventReadPayload
    >;
  },
  {
    readonly record: (event: QueueEventOf<Tag>) => Effect.Effect<void>;
    readonly events: (
      payload?: { readonly limit?: number },
    ) => Effect.Effect<ReadonlyArray<QueueEventOf<Tag>>>;
  }
>;

/** @internal */
export const queueItemSchemaFromTag = <Tag extends QueueStoreTag>(
  tag: Tag,
): QueueItemSchemaFromTag<Tag> => {
  const addMethod = tag[specSym].add as {
    readonly payload?: {
      readonly members?: ReadonlyArray<Schema.Schema<unknown>>;
    };
  };
  const itemSchema = addMethod.payload?.members?.[0];
  if (itemSchema === undefined) {
    throw new Error(`QueueResource.store: tag ${tag.key} has no item schema on spec.add`);
  }
  return itemSchema as QueueItemSchemaFromTag<Tag>;
};

/**
 * Build the queue store contract from an item schema directly (no tag) — used by the engine, which
 * has the item schema but not always a tag (`QueueResource.make`). @internal
 */
export const makeQueueStoreContract = <Item extends Schema.Top>(itemSchema: Item) =>
  Store.contract(
    {
      event: Store.shape(queueEvent(itemSchema), queueEventReadPayload),
    },
    ({ event }) => ({
      record: event.append,
      events: event.read,
    }),
  );

/**
 * Built-in queue store contract for a tag. Delegates to {@link makeQueueStoreContract} with the
 * tag's item schema. @internal
 */
export const builtInQueueStoreContract = <const Tag extends QueueStoreTag>(
  tag: Tag,
): BuiltInQueueContract<Tag> => makeQueueStoreContract(queueItemSchemaFromTag(tag));

/** @deprecated Internal flat spec — use {@link builtInQueueStoreContract}. @internal */
export const builtInQueueStoreSpec = (tag: QueueStoreTag) => builtInQueueStoreContract(tag).spec;

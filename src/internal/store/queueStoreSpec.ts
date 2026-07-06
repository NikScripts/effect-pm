/**
 * Built-in {@link QueueResource} store contract — item schema injected from the queue tag.
 *
 * @module internal/store/queueStoreSpec
 * @internal
 */

import { Schema } from "effect";
import type { Simplify } from "effect/Types";
import type { ResourceTag, Spec, SpecOf } from "../../Resource";
import { specSym } from "../../Resource";
import { queueSpec } from "../../QueueResource";
import {
  makeStoreContractValue,
  makeStoreShape,
  type ShapeNamespaceMembers,
  type StoreContractValue,
  type StoreShapeDef,
} from "./contractDef";
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

/** Built-in `entry` row schema for a queue tag. @internal */
export type QueueEntryRowSchema<Tag extends QueueStoreTag> = Schema.Struct<
  Simplify<{
    readonly queueId: typeof Schema.String;
    readonly entryId: typeof Schema.String;
    readonly item: Schema.Struct<QueueItemFields<Tag>>;
  }>
>;

/** Read payload for built-in `entry` / `entries` queries. @internal */
export const queueEntryReadPayload = Schema.Struct({
  limit: Schema.optional(Schema.Number),
});

export type QueueBuiltInShapes<Tag extends QueueStoreTag> = {
  readonly entry: StoreShapeDef<
    QueueEntryRowSchema<Tag>,
    typeof queueEntryReadPayload
  >;
};

/** Part 2 custom aliases on the built-in queue store contract. @internal */
export type QueueBuiltInCustom<Tag extends QueueStoreTag> = {
  readonly recordEntry: ShapeNamespaceMembers<
    QueueEntryRowSchema<Tag>,
    typeof queueEntryReadPayload
  >["append"];
  readonly entries: ShapeNamespaceMembers<
    QueueEntryRowSchema<Tag>,
    typeof queueEntryReadPayload
  >["read"];
};

/** Built-in queue store contract for a tag — item schema threaded into entry shapes. @internal */
export type BuiltInQueueContract<Tag extends QueueStoreTag> = StoreContractValue<
  QueueBuiltInShapes<Tag>,
  QueueBuiltInCustom<Tag>
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
 * Built-in queue store contract for a tag — item schema threaded into entry shapes.
 *
 * @internal
 */
export const builtInQueueStoreContract = <const Tag extends QueueStoreTag>(
  tag: Tag,
): BuiltInQueueContract<Tag> => {
  const itemSchema = queueItemSchemaFromTag(tag);
  const entryFact = Schema.Struct({
    queueId: Schema.String,
    entryId: Schema.String,
    item: itemSchema,
  });

  return makeStoreContractValue(
    {
      entry: makeStoreShape(entryFact, queueEntryReadPayload),
    },
    ({ entry }) => ({
      recordEntry: entry.append,
      entries: entry.read,
    }),
  ) as unknown as BuiltInQueueContract<Tag>;
};

/** @deprecated Internal flat spec — use {@link builtInQueueStoreContract}. @internal */
export const builtInQueueStoreSpec = (tag: QueueStoreTag) => builtInQueueStoreContract(tag).spec;

/**
 * @module internal/queueSchema
 *
 * The queue's **wire/error schemas** that both the engine (`QueueResource`) and the contract
 * (`QueueContract`) need — kept in their own light module (imports only `effect`) so the contract's
 * `Tag` / spec is **engine-free** and tree-shakes cleanly. The engine re-exports these for
 * back-compat; the contract imports them directly from here.
 */
import { Schema } from "effect";

/**
 * Runtime schema for a queue item's codec descriptor (id / version / encoding / jsonSchema).
 *
 * @category item codecs
 * @public
 */
export const QueueItemCodecDescriptorSchema = Schema.Struct({
  id: Schema.String,
  version: Schema.String,
  encoding: Schema.Literal("json"),
  jsonSchema: Schema.Unknown,
});

/**
 * Encoded release was requested for a queue without `itemSchema`.
 *
 * `Schema.TaggedErrorClass` so it is both a yieldable/throwable error **and** wire-encodable —
 * part of the `releaseEncoded` RPC error channel.
 *
 * @category errors
 * @public
 */
export class QueueMissingItemSchemaError extends Schema.TaggedErrorClass<QueueMissingItemSchemaError>()(
  "QueueMissingItemSchemaError",
  {
    queue: Schema.String,
  },
) {}

/**
 * A queue item failed schema encoding while preparing a wire handoff release.
 *
 * `Schema.TaggedErrorClass` so it is both a yieldable/throwable error **and** wire-encodable —
 * part of the `releaseEncoded` RPC error channel.
 *
 * @category errors
 * @public
 */
export class QueueItemEncodingError extends Schema.TaggedErrorClass<QueueItemEncodingError>()(
  "QueueItemEncodingError",
  {
    queue: Schema.String,
    entryId: Schema.String,
    message: Schema.String,
    codecId: Schema.optionalKey(Schema.String),
  },
) {}

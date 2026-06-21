/**
 * **Queue contract (control surface)** — the fixed-schema half of a queue's service
 * expressed as a {@link Resource} {@link Spec}, so a queue can be driven **remotely** over
 * RPC through the toolkit's location-transparent layers (the same `yield* Tag` code runs
 * local or remote; only the layer changes).
 *
 * @remarks
 * This is the first slice of porting `QueueResource` onto the toolkit. It covers the
 * **control / observation** verbs only — `size`, `sizes`, `isEmpty`, `completed`, `start`,
 * `pause`, `resume`, `shutdown`, `clear` — all of which have fixed schemas (no item type).
 *
 * The **data-plane** verbs (`add` / `prioritize` / `defer` / `release` / `releaseEncoded`
 * / `deadLetter` / `drop`) involve the per-queue item type `T` and its `itemSchema`, and
 * land in a later slice: the wire `add` is a generic **encoded** rpc, with the per-queue
 * `itemSchema` encoding client-side / decoding server-side via `QueueItemCodecDescriptor`.
 *
 * @module QueueContract
 */
import { Schema } from "effect";
import { Resource } from "./Resource";

/**
 * The per-priority pending counts returned by `sizes`.
 *
 * @public
 */
export const QueueSizes = Schema.Struct({
  high: Schema.Number,
  normal: Schema.Number,
  low: Schema.Number,
});

/**
 * The queue **control + observation** contract: the fixed-schema verbs of a queue handle,
 * shared by every queue instance. The data-plane (item-typed) verbs are added in a later
 * slice. Mirrors the matching members of `QueueResource`'s `QueueHandleApi`.
 *
 * @public
 */
export const QueueControlSpec = {
  size: Resource.query(Schema.Number).annotate({
    description: "Total pending items across all priority levels.",
  }),
  sizes: Resource.query(QueueSizes).annotate({
    description: "Pending item count per priority level.",
  }),
  isEmpty: Resource.query(Schema.Boolean).annotate({
    description: "Whether all priority queues are empty.",
  }),
  completed: Resource.query(Schema.Number).annotate({
    description: "Total items that have finished processing (success or failure).",
  }),
  start: Resource.mutate(Schema.Void).annotate({
    description:
      "Fork the worker pool + lifecycle monitor (idempotent; no-op after shutdown).",
  }),
  pause: Resource.mutate(Schema.Void).annotate({
    description: "Pause processing; items can still be enqueued and accumulate.",
  }),
  resume: Resource.mutate(Schema.Void).annotate({
    description: "Resume processing after a pause.",
  }),
  shutdown: Resource.mutate(Schema.Void).annotate({
    description: "Permanently stop the queue; later enqueues are dropped.",
    destructive: true,
  }),
  clear: Resource.mutate(Schema.Number).annotate({
    description:
      "Drain all pending items and reset the completed counter; returns the count cleared.",
    destructive: true,
  }),
};
// Note: no `satisfies Spec` — it contextually widens each method's error channel to
// `unknown`. The spec is validated (without widening) at the `Resource.tagFor` call site.

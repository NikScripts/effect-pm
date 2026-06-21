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
import type { Spec } from "./Resource";

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
  size: {
    success: Schema.Number,
    kind: "query",
    description: "Total pending items across all priority levels.",
  },
  sizes: {
    success: QueueSizes,
    kind: "query",
    description: "Pending item count per priority level.",
  },
  isEmpty: {
    success: Schema.Boolean,
    kind: "query",
    description: "Whether all priority queues are empty.",
  },
  completed: {
    success: Schema.Number,
    kind: "query",
    description: "Total items that have finished processing (success or failure).",
  },
  start: {
    success: Schema.Void,
    kind: "action",
    description: "Fork the worker pool + lifecycle monitor (idempotent; no-op after shutdown).",
  },
  pause: {
    success: Schema.Void,
    kind: "action",
    description: "Pause processing; items can still be enqueued and accumulate.",
  },
  resume: {
    success: Schema.Void,
    kind: "action",
    description: "Resume processing after a pause.",
  },
  shutdown: {
    success: Schema.Void,
    kind: "action",
    destructive: true,
    description: "Permanently stop the queue; later enqueues are dropped.",
  },
  clear: {
    success: Schema.Number,
    kind: "action",
    destructive: true,
    description: "Drain all pending items and reset the completed counter; returns the count cleared.",
  },
} satisfies Spec;

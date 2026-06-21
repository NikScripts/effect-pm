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
 * / `deadLetter` / `drop`) involve the per-queue item type `T` and its `itemSchema`. Each
 * queue instance is its **own** resource (its own RPC group, prefixed by its id) — built by
 * {@link defineQueueTag} from the shared control spec plus per-instance data procedures
 * whose payload/result schema **is** the instance's `itemSchema`, so Effect RPC validates
 * items natively on both sides (no codec descriptor, no manual encode/decode). This is the
 * "model B / fully per-instance" approach; the shared-spec + `id`-header path
 * ({@link Resource.serveInstances}) remains for resources whose contract is identical
 * across instances (e.g. RunResource).
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
export const queueSizes = Schema.Struct({
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
export const queueControlSpec = {
  size: Resource.query(Schema.Number).annotate({
    description: "Total pending items across all priority levels.",
  }),
  sizes: Resource.query(queueSizes).annotate({
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
// `unknown`. The spec is validated (without widening) at the `Resource.Tag` call site.

/**
 * Build a queue **instance** spec (model B): the shared {@link queueControlSpec} plus
 * per-instance data-plane procedures typed by `itemSchema` (slice 1: `add`). Pass the
 * result to {@link Resource.Tag} — each instance is its own resource (its own RPC group):
 *
 * ```ts
 * class Jobs extends Resource.Tag<Jobs>("@app/Jobs")(queueSpec(JobSchema)) {}
 * const q = yield* Jobs;
 * yield* q.add({ item: aJob }); // validated natively against JobSchema on both sides
 * ```
 *
 * `itemSchema` becomes the rpc payload schema, so RPC validates items on the wire — the
 * client rejects bad items before the round trip and the server re-validates on decode.
 *
 * @public
 */
export const queueSpec = <Sch extends Schema.Top>(itemSchema: Sch) => ({
  ...queueControlSpec,
  add: Resource.mutate(Schema.Void, {
    payload: { item: itemSchema },
  }),
});

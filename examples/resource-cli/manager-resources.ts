/**
 * @module examples/resource-cli/manager-resources
 *
 * The resources, layers, and the composed `Record` — defined **once** and shared
 * by every projection: the CLI (`manager-cli.ts`), the TUI (`manager-tui.tsx`),
 * and the unified entry (`pm.tsx`). Configure the surface here; pick a renderer
 * there.
 *
 * - `Counter` — a plain resource (a live `current`, an `increment({ by })`).
 * - `QueueManager` — a manager tag owning many queue instances (`list`,
 *   `status({ id })`, `pause/resume/enqueue({ id, … })`).
 */

import { Effect, Layer, Schema } from "effect";
import * as Resource from "../../src/Resource";

export class Counter extends Resource.Tag<Counter>()("Counter", {
  current: Resource.effect(Schema.Number),
  increment: Resource.effectFn(Schema.Void, { payload: { by: Schema.Number } }),
  reset: Resource.effectFn(Schema.Void).annotate({ destructive: true }),
}) {}

export class QueueManager extends Resource.Tag<QueueManager>()("QueueManager", {
  list: Resource.effect(Schema.Array(Schema.String)),
  status: Resource.effect(
    Schema.Struct({
      id: Schema.String,
      pending: Schema.Number,
      paused: Schema.Boolean,
    }),
    { payload: { id: Schema.String } },
  ),
  pause: Resource.effectFn(Schema.Void, { payload: { id: Schema.String } }),
  resume: Resource.effectFn(Schema.Void, { payload: { id: Schema.String } }),
  enqueue: Resource.effectFn(Schema.Void, {
    payload: { id: Schema.String, item: Schema.String },
  }),
}) {}

let count = 0;
export const counterLayer = Resource.layer(Counter, {
  current: Effect.sync(() => count),
  increment: ({ by }) =>
    Effect.sync(() => {
      count += by;
    }),
  reset: Effect.sync(() => {
    count = 0;
  }),
});

const queues = new Map<string, { pending: number; paused: boolean }>([
  ["jobs", { pending: 0, paused: false }],
  ["mail", { pending: 2, paused: true }],
]);
const at = (id: string) => queues.get(id) ?? { pending: 0, paused: false };

export const queueManagerLayer = Resource.layer(QueueManager, {
  list: Effect.sync(() => Array.from(queues.keys())),
  status: ({ id }) =>
    Effect.sync(() => ({ id, pending: at(id).pending, paused: at(id).paused })),
  pause: ({ id }) =>
    Effect.sync(() => {
      queues.set(id, { ...at(id), paused: true });
    }),
  resume: ({ id }) =>
    Effect.sync(() => {
      queues.set(id, { ...at(id), paused: false });
    }),
  enqueue: ({ id }) =>
    Effect.sync(() => {
      const q = at(id);
      queues.set(id, { ...q, pending: q.pending + 1 });
    }),
});

/** The one record — every renderer derives from this. */
export const resources = { counter: Counter, queue: QueueManager };

/** The merged layer providing every resource in `resources`. */
export const resourcesLayer = Layer.mergeAll(counterLayer, queueManagerLayer);

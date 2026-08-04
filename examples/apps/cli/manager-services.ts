/**
 * @module examples/apps/cli/manager-services
 *
 * The HyperServices, layers, and the composed `Record` — defined **once** and shared
 * by every projection: the CLI (`manager-cli.ts`), the TUI (`manager-tui.tsx`),
 * and the unified entry (`hyperlink.tsx`). Configure the surface here; pick a renderer
 * there.
 *
 * - `Counter` — a plain HyperService (a live `current`, an `increment({ by })`).
 * - `QueueManager` — a manager tag owning many queue instances (`list`,
 *   `status({ id })`, `pause/resume/enqueue({ id, … })`).
 */

import { Effect, Layer, Schema } from "effect";
import * as Hyperlink from "../../../src/Hyperlink";

export class Counter extends Hyperlink.Service<Counter>()("Counter", {
  current: Hyperlink.effect(Schema.Number),
  increment: Hyperlink.effectFn({ by: Schema.Number }),
  reset: Hyperlink.effect(Schema.Void).annotate({ destructive: true }),
}) {}

export class QueueManager extends Hyperlink.Service<QueueManager>()("QueueManager", {
  list: Hyperlink.effect(Schema.Array(Schema.String)),
  status: Hyperlink.effectFn(
    { id: Schema.String },
    Schema.Struct({
      id: Schema.String,
      pending: Schema.Number,
      paused: Schema.Boolean,
    }),
  ),
  pause: Hyperlink.effectFn({ id: Schema.String }),
  resume: Hyperlink.effectFn({ id: Schema.String }),
  enqueue: Hyperlink.effectFn({ id: Schema.String, item: Schema.String }),
}) {}

let count = 0;
export const counterLayer = Hyperlink.layer(Counter, {
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

export const queueManagerLayer = Hyperlink.layer(QueueManager, {
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
export const services = { counter: Counter, queue: QueueManager };

/** The merged layer providing every HyperService in `services`. */
export const servicesLayer = Layer.mergeAll(counterLayer, queueManagerLayer);

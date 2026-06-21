/**
 * @module examples/resource-cli/manager-cli
 *
 * Two resources, one CLI — the `Record` composition. `Counter` is a plain
 * resource; `QueueManager` is a **manager tag**: one resource whose contract owns
 * many instances (`list`, `status({ id })`, `pause({ id })`, …). That's how
 * "control many queues" works without dynamic-instance machinery, and how the old
 * `ls`/`queues`/`pause <name>` come back — derived from the contract.
 *
 *   tsx examples/resource-cli/manager-cli.ts queue list
 *   tsx examples/resource-cli/manager-cli.ts queue status --id mail
 *   tsx examples/resource-cli/manager-cli.ts queue enqueue --id jobs --item hello
 *   tsx examples/resource-cli/manager-cli.ts counter increment --by 3
 *   tsx examples/resource-cli/manager-cli.ts --help
 */

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Schema } from "effect";
import { Command } from "effect/unstable/cli";
import { Resource } from "../../src/Resource";
import { makeResourceCli } from "./resource-cli";

// ── a plain resource ──
class Counter extends Resource.Tag<Counter>("Counter")({
  current: Resource.query(Schema.Number),
  increment: Resource.mutate(Schema.Void, { payload: { by: Schema.Number } }),
}) {}

let count = 0;
const counterLayer = Resource.layer(Counter, {
  current: Effect.sync(() => count),
  increment: ({ by }) =>
    Effect.sync(() => {
      count += by;
    }),
});

// ── a manager resource: one tag owning many queue instances ──
class QueueManager extends Resource.Tag<QueueManager>("QueueManager")({
  list: Resource.query(Schema.Array(Schema.String)),
  status: Resource.query(
    Schema.Struct({
      id: Schema.String,
      pending: Schema.Number,
      paused: Schema.Boolean,
    }),
    { payload: { id: Schema.String } },
  ),
  pause: Resource.mutate(Schema.Void, { payload: { id: Schema.String } }),
  resume: Resource.mutate(Schema.Void, { payload: { id: Schema.String } }),
  enqueue: Resource.mutate(Schema.Void, {
    payload: { id: Schema.String, item: Schema.String },
  }),
}) {}

const queues = new Map<string, { pending: number; paused: boolean }>([
  ["jobs", { pending: 0, paused: false }],
  ["mail", { pending: 2, paused: true }],
]);
const at = (id: string) => queues.get(id) ?? { pending: 0, paused: false };

const queueManagerLayer = Resource.layer(QueueManager, {
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

const cli = makeResourceCli({ counter: Counter, queue: QueueManager }, "pm");

const program = Command.runWith(cli, { version: "0.0.0" })(
  process.argv.slice(2),
).pipe(
  Effect.provide(counterLayer),
  Effect.provide(queueManagerLayer),
  Effect.provide(NodeServices.layer),
);

// Boundary: loose requirement from the dynamic record of tags; the layers above
// fully provide it at run time.
NodeRuntime.runMain(program as Effect.Effect<void, unknown>);

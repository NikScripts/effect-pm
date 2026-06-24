/**
 * @module examples/resource-cli/counter-cli
 *
 * A runnable CLI built from a single `Resource` tag with a local layer — the
 * resource runs in-process. Swap `Resource.layer` for an RPC client layer later
 * to drive a running server; the command tree is unchanged.
 *
 *   tsx examples/resource-cli/counter-cli.ts counter current
 *   tsx examples/resource-cli/counter-cli.ts counter increment --by 5
 *   tsx examples/resource-cli/counter-cli.ts --help
 */

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer, Schema } from "effect";
import { Command } from "effect/unstable/cli";
import { Resource } from "../../src/Resource";
import { makeResourceCli } from "./resource-cli";

class Counter extends Resource.Tag<Counter>("Counter")({
  current: Resource.query(Schema.Number),
  reset: Resource.mutate(Schema.Void),
  increment: Resource.mutate(Schema.Void, { payload: { by: Schema.Number } }),
}) {}

let value = 0;
const counterLayer = Resource.layer(Counter, {
  current: Effect.sync(() => value),
  reset: Effect.sync(() => {
    value = 0;
  }),
  increment: ({ by }) =>
    Effect.sync(() => {
      value += by;
    }),
});

const cli = makeResourceCli({ counter: Counter }, "counter-cli");

const program = Command.runWith(cli, { version: "0.0.0" })(
  process.argv.slice(2),
).pipe(
  Effect.provide(counterLayer.pipe(Layer.provideMerge(NodeServices.layer))),
);

// Boundary: the command's requirement is loose (it's built from a dynamic record
// of tags); the resource + node layers above fully provide it at run time.
NodeRuntime.runMain(program as Effect.Effect<void, unknown>);

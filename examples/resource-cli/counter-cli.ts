/**
 * @module examples/resource-cli/counter-cli
 *
 * A runnable CLI built from a single `Hyperlink` tag with a local layer — the
 * resource runs in-process. Swap `Hyperlink.layer` for an RPC client layer later
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
import * as Hyperlink from "../../src/Hyperlink";
import { makeResourceCli } from "../../src/cli";

class Counter extends Hyperlink.Tag<Counter>()("Counter", {
  current: Hyperlink.effect(Schema.Number),
  reset: Hyperlink.effect(Schema.Void),
  increment: Hyperlink.effectFn({ by: Schema.Number }),
}) {}

let value = 0;
const counterLayer = Hyperlink.layer(Counter, {
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

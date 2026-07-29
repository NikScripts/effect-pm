/**
 * @module examples/apps/cli/counter-cli
 *
 * A runnable CLI built from a single `Hyperlink` tag with a local layer — the
 * resource runs in-process. Swap `Hyperlink.layer` for an RPC client layer later
 * to drive a running server; the command tree is unchanged.
 *
 *   tsx examples/apps/cli/counter-cli.ts counter current
 *   tsx examples/apps/cli/counter-cli.ts counter increment --by 5
 *   tsx examples/apps/cli/counter-cli.ts --help
 *
 * Bare `counter` (no action) needs `hyperlink-ts/tui`'s layer — this example is CLI-only.
 */

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer, Schema } from "effect";
import { cli, type CliRun, TuiNotConfigured } from "../../../src/cli";
import * as Hyperlink from "../../../src/Hyperlink";

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

const runCli = cli(
  { counter: Counter },
  { name: "counter-cli", version: "0.0.0" },
) as CliRun;

const program = runCli(process.argv.slice(2)).pipe(
  Effect.provide(counterLayer.pipe(Layer.provideMerge(NodeServices.layer))),
);

// Boundary: the command's requirement is loose (it's built from a dynamic record
// of tags); the HyperService + node layers above fully provide it at run time.
NodeRuntime.runMain(program as Effect.Effect<void, TuiNotConfigured, never>);

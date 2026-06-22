/**
 * @module examples/resource-tui/group-terminal
 *
 * The TUI as a command handler in your own CLI — `Terminal.make(tags)` passed
 * straight to `Command.make`.
 *
 *   pnpm run example:group-terminal my-group      # launches the dashboard
 *   pnpm run example:group-terminal --help
 */

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";
import { Command } from "effect/unstable/cli";
import {
  Counter,
  QueueManager,
  resourcesLayer,
} from "../resource-cli/manager-resources";
import { Terminal } from "./terminal";

const myGroup = Command.make(
  "my-group",
  {},
  Terminal.make([Counter, QueueManager]),
);

const acme = Command.make("acme").pipe(Command.withSubcommands([myGroup]));

const program = Command.runWith(acme, { version: "0.0.0" })(
  process.argv.slice(2),
).pipe(Effect.provide(Layer.mergeAll(resourcesLayer, NodeServices.layer)));

// Boundary: loose requirement from the dynamic tags; the layer provides it.
NodeRuntime.runMain(program as Effect.Effect<void, unknown>);

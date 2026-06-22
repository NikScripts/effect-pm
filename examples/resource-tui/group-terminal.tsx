/**
 * @module examples/resource-tui/group-terminal
 *
 * The group is the **root** command — running the script launches its dashboard
 * (where you reach every member's TUI). Nothing sits on top of it; you'd only add
 * subcommands if you want typed shortcuts.
 *
 *   pnpm run example:group-terminal           # runs the root → the group dashboard
 *   pnpm run example:group-terminal --help
 */

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";
import { Command } from "effect/unstable/cli";
import { Group } from "../resource-cli/group";
import {
  Counter,
  QueueManager,
  resourcesLayer,
} from "../resource-cli/manager-resources";
import { Terminal } from "./terminal";

// a real tag; members are accessors — MyGroup.Counter, MyGroup.QueueManager
class MyGroup extends Group.Tag<MyGroup>("@nikscripts/effect-pm/MyGroup")({
  Counter,
  QueueManager,
}) {}

// the group IS the root — running the script launches its dashboard. The name is
// just the program name (shown in --help), never typed.
const root = Terminal.command("my-group", MyGroup);

// Only if you want a typed shortcut do you add a subcommand on top, e.g.:
//   const root = Terminal.command("my-group", MyGroup).pipe(
//     Command.withSubcommands([Terminal.command("counter", MyGroup.Counter)]));

const program = Command.runWith(root, { version: "0.0.0" })(
  process.argv.slice(2),
).pipe(Effect.provide(Layer.mergeAll(resourcesLayer, NodeServices.layer)));

// Boundary: loose requirement from the dynamic tags; the layer provides it.
NodeRuntime.runMain(program as Effect.Effect<void, unknown>);

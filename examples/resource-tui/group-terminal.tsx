/**
 * @module examples/resource-tui/group-terminal
 *
 * A group as the root command, its members as subcommands — each a TUI.
 *
 *   pnpm run example:group-terminal my-group Counter        # Counter's TUI
 *   pnpm run example:group-terminal my-group QueueManager   # QueueManager's TUI
 *   pnpm run example:group-terminal my-group --help
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

// pass the tags into the group constructor; get them back out via Group.members
class MyGroup extends Group.Tag("my-group")([Counter, QueueManager]) {}

// group as root, members as subcommands (Terminal.all spits out the array)
const root = Command.make(MyGroup.id).pipe(
  Command.withSubcommands(Terminal.all(MyGroup)),
);

const program = Command.runWith(root, { version: "0.0.0" })(
  process.argv.slice(2),
).pipe(Effect.provide(Layer.mergeAll(resourcesLayer, NodeServices.layer)));

// Boundary: loose requirement from the dynamic tags; the layer provides it.
NodeRuntime.runMain(program as Effect.Effect<void, unknown>);

/**
 * @module examples/resource-tui/group-terminal
 *
 * A group as the root command, its members as subcommands — each a TUI. The group
 * is a real tag (Group.Tag); a Command.make per member tag.
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

// a real tag — pass the members in, get them back out via Group.members
class MyGroup extends Group.Tag<MyGroup>("my-group")([Counter, QueueManager]) {}

// group as root; one Command.make per member tag
const root = Command.make(MyGroup.id).pipe(
  Command.withSubcommands(
    Group.members(MyGroup).map((tag) =>
      Command.make(tag.id, {}, Terminal.make(tag)),
    ),
  ),
);

const program = Command.runWith(root, { version: "0.0.0" })(
  process.argv.slice(2),
).pipe(Effect.provide(Layer.mergeAll(resourcesLayer, NodeServices.layer)));

// Boundary: loose requirement from the dynamic tags; the layer provides it.
NodeRuntime.runMain(program as Effect.Effect<void, unknown>);

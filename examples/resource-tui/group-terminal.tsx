/**
 * @module examples/resource-tui/group-terminal
 *
 * The group as the **root** command — no args launches the group dashboard (where
 * you reach every member's TUI); a subcommand is just an optional shortcut.
 *
 *   pnpm run example:group-terminal           # the group dashboard (root, no args)
 *   pnpm run example:group-terminal counter   # shortcut straight to Counter's TUI
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

// the group is the root — `pm` alone launches its dashboard; `pm counter` is a
// shortcut you opt into (you don't need it — the dashboard reaches every member)
const root = Terminal.command("my-group", MyGroup).pipe(
  Command.withSubcommands([Terminal.command("counter", MyGroup.Counter)]),
);

const program = Command.runWith(root, { version: "0.0.0" })(
  process.argv.slice(2),
).pipe(Effect.provide(Layer.mergeAll(resourcesLayer, NodeServices.layer)));

// Boundary: loose requirement from the dynamic tags; the layer provides it.
NodeRuntime.runMain(program as Effect.Effect<void, unknown>);

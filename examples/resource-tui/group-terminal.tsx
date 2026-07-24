/**
 * @module examples/resource-tui/group-terminal
 *
 * The group is the root — bare invoke opens its TUI; member paths + actions are CLI verbs.
 *
 *   pnpm run example:group-terminal           # TUI at root
 *   pnpm run example:group-terminal Counter   # TUI focused on Counter
 *   pnpm run example:group-terminal Counter current
 *   pnpm run example:group-terminal --help
 */

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";
import { Command } from "effect/unstable/cli";
import * as Group from "../../src/Group";
import * as Hyperlink from "../../src/Hyperlink";
import { layer as tuiLayer } from "../../src/tui";
import {
  Counter,
  QueueManager,
  resourcesLayer,
} from "../resource-cli/manager-resources";

class MyGroup extends Group.Tag<MyGroup>("hyperlink-ts/MyGroup")({
  Counter,
  QueueManager,
}) {}

const command = Hyperlink.cli(MyGroup, "my-group");

const program = Command.runWith(command, { version: "0.0.0" })(
  process.argv.slice(2),
).pipe(Effect.provide(Layer.mergeAll(resourcesLayer, tuiLayer, NodeServices.layer)));

// Boundary: loose requirement from the dynamic tags; the layer provides it.
NodeRuntime.runMain(program as Effect.Effect<void, unknown>);

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

const raw = process.argv.slice(
  Math.max(
    2,
    process.argv.findIndex((a) => a.endsWith("group-terminal.tsx")) + 1,
  ),
);
const args = raw[0] === "--" ? raw.slice(1) : raw;

const program = Hyperlink.cli(MyGroup, {
  name: "my-group",
  version: "0.0.0",
})(args).pipe(
  Effect.provide(Layer.mergeAll(resourcesLayer, tuiLayer, NodeServices.layer)),
);

// Boundary: loose requirement from the dynamic tags; the layer provides it.
NodeRuntime.runMain(program as Effect.Effect<void, unknown>);

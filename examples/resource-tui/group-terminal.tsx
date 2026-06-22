/**
 * @module examples/resource-tui/group-terminal
 *
 * A group tag as a TUI command — pass the group straight to `Terminal.make`.
 *
 *   pnpm run example:group-terminal my-group     # the group's dashboard (all members)
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

const root = Command.make("my-group", {}, Terminal.make(MyGroup));

const program = Command.runWith(root, { version: "0.0.0" })(
  process.argv.slice(2),
).pipe(Effect.provide(Layer.mergeAll(resourcesLayer, NodeServices.layer)));

// Boundary: loose requirement from the dynamic tags; the layer provides it.
NodeRuntime.runMain(program as Effect.Effect<void, unknown>);

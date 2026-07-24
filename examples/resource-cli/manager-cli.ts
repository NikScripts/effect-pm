/**
 * @module examples/resource-cli/manager-cli
 *
 * Two resources, one CLI — the `Record` composition. The resources live in
 * `manager-resources.ts` (shared with the TUI); here we just project them to a CLI.
 * `Counter` is a plain resource; `QueueManager` is a **manager tag**: one resource
 * whose contract owns many instances (`list`, `status({ id })`, `pause({ id })`, …) —
 * how "control many queues" works without dynamic-instance machinery.
 *
 *   tsx examples/resource-cli/manager-cli.ts queue list
 *   tsx examples/resource-cli/manager-cli.ts queue status --id mail
 *   tsx examples/resource-cli/manager-cli.ts counter increment --by 3
 *   tsx examples/resource-cli/manager-cli.ts --help
 */

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";
import * as Hyperlink from "../../src/Hyperlink";
import { resources, resourcesLayer } from "./manager-resources";

const program = Hyperlink.cli(resources, {
  name: "hyperlink",
  version: "0.0.0",
})(process.argv.slice(2)).pipe(
  Effect.provide(Layer.mergeAll(resourcesLayer, NodeServices.layer)),
);

// Boundary: loose requirement from the dynamic record of tags; the layer above
// fully provides it at run time.
NodeRuntime.runMain(program as Effect.Effect<void, unknown>);

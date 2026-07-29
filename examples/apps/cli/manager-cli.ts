/**
 * @module examples/apps/cli/manager-cli
 *
 * Two HyperServices, one CLI — the `Record` composition. The HyperServices live in
 * `manager-services.ts` (shared with the TUI); here we just project them to a CLI.
 * `Counter` is a plain HyperService; `QueueManager` is a **manager tag**: one HyperService
 * whose contract owns many instances (`list`, `status({ id })`, `pause({ id })`, …) —
 * how "control many queues" works without dynamic-instance machinery.
 *
 *   tsx examples/apps/cli/manager-cli.ts queue list
 *   tsx examples/apps/cli/manager-cli.ts queue status --id mail
 *   tsx examples/apps/cli/manager-cli.ts counter increment --by 3
 *   tsx examples/apps/cli/manager-cli.ts --help
 */

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";
import { cli, type CliRun, TuiNotConfigured } from "../../../src/cli";
import { services, servicesLayer } from "./manager-services";

const runCli = cli(services, {
  name: "hyperlink",
  version: "0.0.0",
}) as CliRun;

const program = runCli(process.argv.slice(2)).pipe(
  Effect.provide(Layer.mergeAll(servicesLayer, NodeServices.layer)),
);

// Boundary: loose requirement from the dynamic record of tags; the layer above
// fully provides it at run time.
NodeRuntime.runMain(program as Effect.Effect<void, TuiNotConfigured, never>);

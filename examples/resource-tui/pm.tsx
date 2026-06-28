/**
 * @module examples/resource-tui/pm
 *
 * Configure once, get both. The `Fleet` tree (the tags) drives **two renderers**,
 * chosen by argv:
 *
 *   pnpm run example:pm                       # no subcommand → the styled TUI dashboard
 *   pnpm run example:pm ls                     # list resources (command name → id)
 *   pnpm run example:pm Mail statusNow         # one-shot read, run & exit
 *   pnpm run example:pm Mail pause             # control, run & exit
 *   pnpm run example:pm KeyRotation start
 *   pnpm run example:pm --help
 *
 * Resource command names are the tag's display name (its last id segment: `Mail`,
 * `KeyRotation`). If two resources share one, the resolver lengthens just those to the
 * shortest unique slash-suffix (`Regional/RegionUS`) — everything else stays short.
 *
 * Needs the example servers running (`example:queue-server` + `example:mini-server`);
 * the CLI drives them over http via the same `appLayer` the dashboard uses.
 */

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";
import { Command } from "effect/unstable/cli";
import { KeyRotation, LEAVES } from "../web-dashboard/fleet";
import { appLayer } from "../web-dashboard/queue-data";
import { makeResourceCli, resourcesByName } from "../../src/cli";
import { runDashboard } from "./dashboard-app";

const argv = process.argv.slice(2);

// ── no subcommand → the styled dashboard (same Fleet, same data layer) ──
if (argv.length === 0) {
  runDashboard();
} else {
  // command names = shortest unique slash-suffix of each tag key (Mail, KeyRotation, …).
  const cli = makeResourceCli(resourcesByName([...LEAVES, KeyRotation]), "pm");
  const program = Command.runWith(cli, { version: "0.8.0-beta.6" })(argv).pipe(
    Effect.provide(Layer.mergeAll(appLayer, NodeServices.layer)),
  );
  // Boundary: the heterogeneous resource record erases the requirement to `unknown`;
  // `appLayer` provides every fleet service, so it's fully satisfied at run time.
  NodeRuntime.runMain(program as Effect.Effect<void, unknown>);
}

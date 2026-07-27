/**
 * @module examples/hyperlink-tui/hyperlink
 *
 * Configure once, get both. The `Fleet` group drives **CLI + default TUI**:
 *
 *   pnpm run example:hyperlink                       # TUI at root
 *   pnpm run example:hyperlink Mail                  # TUI focused on Mail
 *   pnpm run example:hyperlink Mail status.get       # one-shot read, run & exit
 *   pnpm run example:hyperlink Mail pause            # control, run & exit
 *   pnpm run example:hyperlink Mini KeyRotation start
 *   pnpm run example:hyperlink ls
 *   pnpm run example:hyperlink --help
 *
 * Needs the example servers running (`example:queue-server` + `example:mini-server`);
 * the CLI drives them over http via the same `appLayer` the dashboard uses.
 */

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";
import { Fleet } from "../web-dashboard/fleet";
import { appLayer } from "../web-dashboard/queue-data";
import * as Hyperlink from "../../src/Hyperlink";
import { layer as tuiLayer } from "../../src/tui";

// Args after this script. `pnpm run example:hyperlink -- Mail` forwards a literal `--`.
const raw = process.argv.slice(
  Math.max(
    2,
    process.argv.findIndex((a) => a.endsWith("hyperlink.tsx")) + 1,
  ),
);
const args = raw[0] === "--" ? raw.slice(1) : raw;

const program = Hyperlink.cli(Fleet, {
  name: "hyperlink",
  version: "0.9.0-beta.0",
})(args).pipe(
  Effect.provide(Layer.mergeAll(appLayer, tuiLayer, NodeServices.layer)),
);
// Boundary: the heterogeneous resource tree erases the requirement to `unknown`;
// `appLayer` provides every fleet service, so it's fully satisfied at run time.
NodeRuntime.runMain(program as Effect.Effect<void, unknown>);

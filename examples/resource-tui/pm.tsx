/**
 * @module examples/resource-tui/pm
 *
 * Configure once, get both. One record + one layer (`manager-resources.ts`) drives
 * **two renderers** chosen by argv:
 *
 *   pnpm run example:pm tui                 # the TUI (makeResourceTui)
 *   pnpm run example:pm queue list          # the CLI (makeResourceCli)
 *   pnpm run example:pm counter increment --by 3
 *   pnpm run example:pm --help
 *
 * This is the shape a user would build for their own resources: define the record,
 * then `makeResourceCli(record)` + `makeResourceTui(record, runtime)`. (The static
 * Ink import is fine now the package is ESM; a library could lazy-`import()` the TUI
 * to keep Ink out of CLI-only startup.)
 */

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { render } from "ink";
import * as React from "react";
import { Effect, Layer } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { Command } from "effect/unstable/cli";
import { resources, resourcesLayer } from "../resource-cli/manager-resources";
import { makeResourceCli } from "../resource-cli/resource-cli";
import { makeResourceTui } from "./make-resource-tui";

const argv = process.argv.slice(2);

if (argv[0] === "tui") {
  // ── TUI projection ──
  const runtime = Atom.runtime(resourcesLayer);
  const { App } = makeResourceTui(resources, runtime);

  const out = process.stdout;
  const tty = out.isTTY === true;
  if (tty) {
    out.write("\x1b[?1049h\x1b[2J\x1b[H");
  }
  const restore = () => {
    if (tty) {
      out.write("\x1b[?1049l");
    }
  };
  const app = render(React.createElement(App));
  void app.waitUntilExit().finally(restore);
  process.on("exit", restore);
} else {
  // ── CLI projection ──
  const cli = makeResourceCli(resources, "pm");
  const program = Command.runWith(cli, { version: "0.0.0" })(argv).pipe(
    Effect.provide(Layer.mergeAll(resourcesLayer, NodeServices.layer)),
  );
  // Boundary: loose requirement from the dynamic record; the layer fully provides it.
  NodeRuntime.runMain(program as Effect.Effect<void, unknown>);
}

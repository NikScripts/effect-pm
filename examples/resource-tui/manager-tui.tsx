/**
 * @module examples/resource-tui/manager-tui
 *
 * The TUI projection of the *same* record the CLI uses (`manager-resources.ts`) —
 * `makeResourceTui(resources, runtime)`. One widget per resource, live `query`
 * fields, numbered actions. Runs in the alternate screen.
 *
 *   pnpm run example:resource-tui-manager
 *   # ←→ select · 1-9 act · : command (e.g. `status id=mail`, `increment by=5`) · q
 */

import { render } from "ink";
import * as React from "react";
import { Atom } from "effect/unstable/reactivity";
import { resources, resourcesLayer } from "../resource-cli/manager-resources";
import { makeResourceTui } from "./make-resource-tui";

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

render(React.createElement(App));
process.on("exit", restore);

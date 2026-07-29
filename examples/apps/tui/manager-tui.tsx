/**
 * @module examples/apps/tui/manager-tui
 *
 * The TUI projection of the *same* record the CLI uses (`manager-services.ts`) —
 * `make(services, runtime)` from `hyperlink-ts/tui`. One widget per HyperService, live
 * `query` fields, numbered actions. Runs in the alternate screen.
 *
 *   pnpm run example:apps-tui-manager
 *   # ←→ select · 1-9 act · : command (e.g. `status id=mail`, `increment by=5`) · q
 */

import { render } from "ink";
import * as React from "react";
import { Atom } from "effect/unstable/reactivity";
import { services, servicesLayer } from "../cli/manager-services";
import { make } from "../../../src/tui";

const runtime = Atom.runtime(servicesLayer);
const { App } = make(services, runtime);

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

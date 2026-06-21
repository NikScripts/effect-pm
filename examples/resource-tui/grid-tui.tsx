/**
 * @module examples/resource-tui/grid-tui
 *
 * Full-screen grid dashboard. Runs in the terminal's **alternate screen** so it's
 * self-contained: it takes over the screen on launch and restores your previous
 * terminal contents on exit.
 *
 *   pnpm run example:resource-tui-grid
 *   # ↑↓←→ / hjkl move, i/d/r act, : command, scroll to page, q quit
 */

import { render } from "ink";
import { App } from "./grid-app";

const out = process.stdout;
const tty = out.isTTY === true;

if (tty) {
  out.write("\x1b[?1049h\x1b[2J\x1b[H"); // enter alternate screen + clear
}
const restore = () => {
  if (tty) {
    out.write("\x1b[?1049l"); // leave alternate screen, restore prior contents
  }
};

const app = render(<App />);
void app.waitUntilExit().finally(restore);
process.on("exit", restore);

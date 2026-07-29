/**
 * @module examples/apps/tui/dashboard
 *
 * Thin example wrapper around the shipped Group TUI {@link Dashboard} — same `Fleet` +
 * `appLayer` the web dashboard uses. Prefer importing `Dashboard` from `hyperlink-ts/tui`
 * (or `../../src/tui`) in apps; this file exists so `pnpm run example:dashboard` still works.
 *
 *   pnpm run example:queue-server  +  example:mini-server  (then this)
 *   pnpm run example:dashboard
 */
import { render } from "ink";
import * as React from "react";
import { Atom } from "effect/unstable/reactivity";
import { Fleet } from "../dashboard/fleet";
import { appLayer } from "../dashboard/queue-data";
import { Dashboard } from "../../../src/tui";

/** Launch the dashboard: enter the alt-screen, render the Ink app, restore on exit. */
export const runDashboard = (): void => {
  const out = process.stdout;
  const tty = out.isTTY === true;
  const restore = () => {
    if (tty) {
      out.write("\x1b[?1000l\x1b[?1006l\x1b[?1049l");
    }
  };
  if (tty) {
    out.write("\x1b[?1049h\x1b[2J\x1b[H");
  }
  process.on("exit", restore);
  const runtime = Atom.runtime(appLayer);
  render(<Dashboard runtime={runtime} group={Fleet} />);
};

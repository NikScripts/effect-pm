/**
 * @module tui/layer
 *
 * Provides {@link Tui} so {@link cli} bare paths (no action) open the Group
 * {@link Dashboard} — the same tree + path model as `<Dashboard group />` on the web.
 */
import { render } from "ink";
import * as React from "react";
import { Effect, Layer } from "effect";
import { Atom } from "effect/unstable/reactivity";
import * as Group from "../Group";
import { Tui, type TuiOpenInput } from "../cli/Tui";
import type { CliTree } from "../cli/types";
import type { GroupNode } from "../ui/data";
import { Dashboard } from "./Dashboard";

const toGroupNode = (tree: CliTree): GroupNode =>
  Group.isGroup(tree) ? tree : { key: "root", members: tree };

const renderTui = (App: () => React.ReactElement): Effect.Effect<void> =>
  Effect.callback<void>((resume) => {
    const out = process.stdout;
    const tty = out.isTTY === true;
    // leave the alt screen only at process exit (the last write) — leaving it in
    // waitUntilExit's finally runs before Ink's final frame, which then lands on
    // the main screen and persists.
    const leave = () => {
      if (tty) {
        out.write("\x1b[?1049l");
      }
    };
    if (tty) {
      out.write("\x1b[?1049h\x1b[2J\x1b[H");
    }
    process.on("exit", leave);
    const app = render(React.createElement(App));
    void app.waitUntilExit().finally(() => resume(Effect.void));
  });

/**
 * Layer that implements {@link Tui.open} with the Group Ink {@link Dashboard}.
 *
 * @public
 */
export const layer: Layer.Layer<Tui> = Layer.succeed(Tui, {
  open: (input: TuiOpenInput) =>
    Effect.gen(function* () {
      const context = yield* Effect.context<never>();
      // Context is erased at the OS edge (same as the old `make` layer) — the provided
      // app layer satisfies every tag the Group actually yields at run time.
      const runtime = Atom.runtime(Layer.succeedContext(context));
      const group = toGroupNode(input.tree);
      const path = input.path;
      yield* renderTui(() =>
        React.createElement(Dashboard<never, never>, {
          runtime,
          group,
          path,
        }),
      );
    }),
});

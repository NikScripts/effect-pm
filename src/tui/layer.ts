/**
 * @module tui/layer
 *
 * Provides {@link Tui} so {@link cli} bare paths (no action) open the Ink dashboard
 * built by {@link make}.
 */
import { render } from "ink";
import * as React from "react";
import { Effect, Layer } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { Tui } from "../cli/Tui";
import type { CliHyperlinkTag } from "../cli/types";
import { make } from "./make";

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
 * Layer that implements {@link Tui.open} with the generic contract-driven Ink dashboard.
 *
 * @public
 */
export const layer: Layer.Layer<Tui> = Layer.succeed(Tui, {
  open: (resources: Record<string, CliHyperlinkTag>) =>
    Effect.gen(function* () {
      const context = yield* Effect.context<never>();
      const runtime = Atom.runtime(Layer.succeedContext(context));
      const { App } = make(resources, runtime);
      yield* renderTui(App);
    }),
});

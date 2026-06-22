/**
 * @module examples/resource-tui/terminal
 *
 * `Terminal.make(tags)` → an `effect/cli` command **handler** that launches the
 * TUI. Drop it straight into `Command.make`:
 *
 *   Command.make("my-group", {}, Terminal.make([Counter, QueueManager]))
 *
 * The handler grabs the ambient Effect context (the resources the CLI already
 * provided), wraps it as the atom runtime, renders the dashboard in the alternate
 * screen, and completes when you quit. Tags are keyed by their own id — no naming.
 */

import { render } from "ink";
import * as React from "react";
import { Effect, Layer } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { makeResourceTui, type AnyTag } from "./make-resource-tui";

const renderTui = (App: () => React.ReactElement): Effect.Effect<void> =>
  Effect.callback<void>((resume) => {
    const out = process.stdout;
    const tty = out.isTTY === true;
    if (tty) {
      out.write("\x1b[?1049h\x1b[2J\x1b[H");
    }
    const app = render(React.createElement(App));
    void app.waitUntilExit().finally(() => {
      if (tty) {
        out.write("\x1b[?1049l");
      }
      resume(Effect.void);
    });
  });

export const Terminal = {
  /** A command handler that renders the given tags as a TUI (keyed by id). */
  make:
    (tags: ReadonlyArray<AnyTag>) =>
    (): Effect.Effect<void, never, unknown> =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const runtime = Atom.runtime(Layer.succeedContext(context));
        const record = Object.fromEntries(tags.map((tag) => [tag.id, tag]));
        const { App } = makeResourceTui(record, runtime);
        yield* renderTui(App);
      }),
};

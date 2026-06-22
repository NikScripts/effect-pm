/**
 * @module examples/resource-tui/terminal
 *
 * `Terminal.make(tag)` → an `effect/cli` command **handler** that launches the TUI
 * for that one tag. Each tag gets its own `Command.make` (which supplies the name);
 * group them with native `Command.withSubcommands`:
 *
 *   const counter = Command.make("counter", {}, Terminal.make(Counter))
 *   const queue   = Command.make("queue",   {}, Terminal.make(QueueManager))
 *   const ops     = Command.make("ops").pipe(Command.withSubcommands([counter, queue]))
 *
 * The handler grabs the ambient Effect context (the resources the CLI already
 * provided), wraps it as the atom runtime, renders in the alternate screen, and
 * completes when you quit.
 */

import { render } from "ink";
import * as React from "react";
import { Effect, Layer } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { Command } from "effect/unstable/cli";
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
  /** A command handler that renders one tag as a TUI. */
  make:
    (tag: AnyTag) =>
    (): Effect.Effect<void, never, unknown> =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const runtime = Atom.runtime(Layer.succeedContext(context));
        const { App } = makeResourceTui({ [tag.id]: tag }, runtime);
        yield* renderTui(App);
      }),

  /**
   * Shortcut: a `{ name: tag }` record → an array of TUI commands, ready for
   * `Command.withSubcommands`.
   *
   *   Command.make("ops").pipe(Command.withSubcommands(Terminal.all({ queue: MyQueue })))
   */
  all: (record: Record<string, AnyTag>) =>
    Object.entries(record).map(([name, tag]) =>
      Command.make(name, {}, Terminal.make(tag)),
    ),
};

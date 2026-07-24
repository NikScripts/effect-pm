import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Layer, Option, Schema } from "effect";
import { Command } from "effect/unstable/cli";
import * as Group from "../src/Group";
import * as Hyperlink from "../src/Hyperlink";
import { cli, render, Tui, TuiNotConfigured } from "../src/cli";

it("renders CLI output by value shape", () => {
  expect(render(undefined)).toBe("ok");
  expect(render(null)).toBe("ok");
  expect(render(0)).toBe("0");
  expect(render("hi")).toBe("hi");
  expect(render(true)).toBe("true");
  expect(render(["jobs", "mail"])).toBe("  jobs\n  mail");
  expect(render([])).toBe("(empty)");
  expect(render({ id: "mail", pending: 2, paused: true })).toBe(
    "  id       mail\n  pending  2\n  paused   true",
  );
});

class Counter extends Hyperlink.Tag<Counter>()("test/cli/Counter", {
  current: Hyperlink.effect(Schema.Number),
  pause: Hyperlink.effect(Schema.Void),
}) {}

class Bundle extends Group.Tag<Bundle>("test/cli/Bundle")({ Counter }) {}

const counterLayer = Hyperlink.layer(Counter, {
  current: Effect.succeed(1),
  pause: Effect.void,
});

const expectTuiNotConfigured = <A, E>(exit: Exit.Exit<A, E>): void => {
  expect(Exit.isFailure(exit)).toBe(true);
  if (!Exit.isFailure(exit)) {
    return;
  }
  const err = Option.getOrThrow(Cause.findErrorOption(exit.cause));
  expect(err).toBeInstanceOf(TuiNotConfigured);
  expect((err as TuiNotConfigured)._tag).toBe("TuiNotConfigured");
};

// Command trees erase resource requirements to `unknown`; layers satisfy them at runtime.
const runCli = (effect: Effect.Effect<void, unknown, unknown>): Effect.Effect<Exit.Exit<void, unknown>> =>
  Effect.exit(effect as Effect.Effect<void, unknown>);

describe("Hyperlink.cli TUI default", () => {
  it.effect("bare root without Tui → TuiNotConfigured", () =>
    Effect.gen(function* () {
      const command = cli(Bundle, "hyperlink");
      const exit = yield* runCli(
        Command.runWith(command, { version: "0.0.0" })([]).pipe(Effect.provide(counterLayer)),
      );
      expectTuiNotConfigured(exit);
    }),
  );

  it.effect("resource path without action without Tui → TuiNotConfigured", () =>
    Effect.gen(function* () {
      const command = Hyperlink.cli({ counter: Counter }, "app");
      const exit = yield* runCli(
        Command.runWith(command, { version: "0.0.0" })(["counter"]).pipe(
          Effect.provide(counterLayer),
        ),
      );
      expectTuiNotConfigured(exit);
    }),
  );

  it.effect("full action runs the verb", () =>
    Effect.gen(function* () {
      const command = cli({ counter: Counter }, "app");
      const exit = yield* runCli(
        Command.runWith(command, { version: "0.0.0" })(["counter", "pause"]).pipe(
          Effect.provide(counterLayer),
        ),
      );
      expect(Exit.isSuccess(exit)).toBe(true);
    }),
  );

  it.effect("bare root with Tui opens via service", () =>
    Effect.gen(function* () {
      let opened: ReadonlyArray<string> | undefined;
      const tuiLayer = Layer.succeed(Tui, {
        open: (resources) =>
          Effect.sync(() => {
            opened = Object.keys(resources);
          }),
      });
      const command = cli(Bundle, "hyperlink");
      const exit = yield* runCli(
        Command.runWith(command, { version: "0.0.0" })([]).pipe(
          Effect.provide(Layer.mergeAll(counterLayer, tuiLayer)),
        ),
      );
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(opened).toEqual(["Counter"]);
    }),
  );
});

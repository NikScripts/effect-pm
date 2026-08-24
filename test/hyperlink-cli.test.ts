import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Cause, Effect, Exit, Layer, Option, Schema } from "effect";
import { Command } from "effect/unstable/cli";
import * as Group from "../src/Group";
import * as Hyperlink from "../src/Hyperlink";
import { byName, cli, render, Tui, TuiNotConfigured } from "../src/cli";


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

class Counter extends Hyperlink.Service<Counter>()("test/cli/Counter", {
  current: Hyperlink.effect(Schema.Number),
  pause: Hyperlink.effect(Schema.Void),
}) {}

class Bundle extends Group.Service<Bundle>("test/cli/Bundle")({ Counter }) {}

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

// Edge: Command.runWith + heterogeneous tags → Environment / CliError; assert on Exit.
const runCli = (args: ReadonlyArray<string>, layer: Layer.Layer<Counter, never, never>) =>
  Effect.exit(
    Command.runWith(cli(Bundle, "hyperlink"), { version: "0.0.0" })(args).pipe(
      Effect.provide(Layer.mergeAll(layer, NodeServices.layer)),
    ),
  );

it("byName shortens unique suffixes", () => {
  expect(Object.keys(byName([Counter]))).toEqual(["Counter"]);
});

describe("Hyperlink.cli TUI default", () => {
  it.effect("bare root without Tui → TuiNotConfigured", () =>
    Effect.gen(function* () {
      const exit = yield* runCli([], counterLayer);
      expectTuiNotConfigured(exit);
    }),
  );

  it.effect("resource path without action without Tui → TuiNotConfigured", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Command.runWith(Hyperlink.cli({ counter: Counter }, "app"), { version: "0.0.0" })([
          "counter",
        ]).pipe(Effect.provide(Layer.mergeAll(counterLayer, NodeServices.layer))),
      );
      expectTuiNotConfigured(exit);
    }),
  );

  it.effect("full action runs the verb", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Command.runWith(cli({ counter: Counter }, "app"), { version: "0.0.0" })([
          "counter",
          "pause",
        ]).pipe(Effect.provide(Layer.mergeAll(counterLayer, NodeServices.layer))),
      );
      expect(Exit.isSuccess(exit)).toBe(true);
    }),
  );

  it.effect("bare root with Tui opens via service", () =>
    Effect.gen(function* () {
      let opened: { treeKey: string; path: ReadonlyArray<string> } | undefined;
      const tuiLayer = Layer.succeed(Tui, {
        open: (input) =>
          Effect.sync(() => {
            opened = {
              treeKey: Group.isGroup(input.tree) ? input.tree.key : "record",
              path: input.path,
            };
          }),
      });
      const exit = yield* Effect.exit(
        Command.runWith(cli(Bundle, "hyperlink"), { version: "0.0.0" })([]).pipe(
          Effect.provide(Layer.mergeAll(counterLayer, tuiLayer, NodeServices.layer)),
        ),
      );
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(opened).toEqual({ treeKey: Bundle.key, path: [] });
    }),
  );

  it.effect("resource path opens Tui focused on that path", () =>
    Effect.gen(function* () {
      let opened: ReadonlyArray<string> | undefined;
      const tuiLayer = Layer.succeed(Tui, {
        open: (input) =>
          Effect.sync(() => {
            opened = input.path;
          }),
      });
      const exit = yield* Effect.exit(
        Command.runWith(cli(Bundle, "hyperlink"), { version: "0.0.0" })(["Counter"]).pipe(
          Effect.provide(Layer.mergeAll(counterLayer, tuiLayer, NodeServices.layer)),
        ),
      );
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(opened).toEqual(["Counter"]);
    }),
  );
});

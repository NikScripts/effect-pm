import { render } from "ink-testing-library";
import { Effect, Schema } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { expect, it } from "vitest";
import * as Hyperlink from "../../src/Hyperlink";
import { makeHyperlinkTui } from "./make-resource-tui";

class Counter extends Hyperlink.Tag<Counter>()("TuiCounter", {
  current: Hyperlink.effect(Schema.Number),
  increment: Hyperlink.effectFn({ by: Schema.Number }),
  reset: Hyperlink.effect(Schema.Void).annotate({ destructive: true }),
}) {}

let v = 0;
const layer = Hyperlink.layer(Counter, {
  current: Effect.sync(() => v),
  increment: ({ by }) =>
    Effect.sync(() => {
      v += by;
    }),
  reset: Effect.sync(() => {
      v = 0;
    }),
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 80));

it("renders a widget per resource with live queries refreshed by command-bar actions", async () => {
  const runtime = Atom.runtime(layer);
  const { App } = makeHyperlinkTui({ counter: Counter }, runtime);
  const { lastFrame, stdin } = render(<App />);
  await tick();

  expect(lastFrame()).toContain("counter");
  expect(lastFrame()).toContain("current");
  expect(lastFrame()).toContain("0");
  expect(lastFrame()).toContain("1 increment"); // numbered actions from the spec

  // command bar: increment by=5 (payload coerced from the field schema)
  stdin.write(":");
  await tick();
  stdin.write("increment by=5");
  await tick();
  stdin.write("\r");
  await tick();
  expect(lastFrame()).toContain("5"); // live query refreshed via reactivity

  // reset (no payload)
  stdin.write(":");
  await tick();
  stdin.write("reset");
  await tick();
  stdin.write("\r");
  await tick();
  expect(lastFrame()).toContain("current");
  expect(lastFrame()).toContain("0");
});

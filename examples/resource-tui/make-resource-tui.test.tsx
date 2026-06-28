import { render } from "ink-testing-library";
import { Effect, Schema } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { expect, it } from "vitest";
import * as Resource from "../../src/Resource";
import { makeResourceTui } from "./make-resource-tui";

class Counter extends Resource.Tag<Counter>("TuiCounter")({
  current: Resource.query(Schema.Number),
  increment: Resource.mutate(Schema.Void, { payload: { by: Schema.Number } }),
  reset: Resource.mutate(Schema.Void).annotate({ destructive: true }),
}) {}

let v = 0;
const layer = Resource.layer(Counter, {
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
  const { App } = makeResourceTui({ counter: Counter }, runtime);
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

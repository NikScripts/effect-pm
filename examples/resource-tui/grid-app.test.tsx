import { render } from "ink-testing-library";
import { expect, it } from "vitest";
import { App } from "./grid-app";

const tick = () => new Promise((resolve) => setTimeout(resolve, 80));

it("renders a grid of widgets, moves selection, acts on the selected one", async () => {
  const { lastFrame, stdin, unmount } = render(<App />);
  await tick();

  const frame = lastFrame() ?? "";
  expect(frame).toContain("resource grid");
  expect(frame).toContain("alpha");
  expect(frame).toContain("foxtrot");
  expect(frame).toContain("[i] +1");
  expect(frame).toContain("▸ alpha"); // selection starts on the first widget

  stdin.write("l"); // move right → bravo
  await tick();
  expect(lastFrame()).toContain("▸ bravo");

  stdin.write("i"); // bravo started at 3 → 4
  await tick();
  expect(lastFrame()).toContain("= 4");

  unmount();
});

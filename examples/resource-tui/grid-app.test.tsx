import { render } from "ink-testing-library";
import { expect, it } from "vitest";
import { App } from "./grid-app";

const tick = () => new Promise((resolve) => setTimeout(resolve, 80));

it("renders a grid, moves selection, and runs commands from the command bar", async () => {
  const { lastFrame, stdin, unmount } = render(<App />);
  await tick();

  const frame = lastFrame() ?? "";
  expect(frame).toContain("resource grid");
  expect(frame).toContain("alpha");
  expect(frame).toContain("foxtrot");
  expect(frame).toContain("[:] command");
  expect(frame).toContain("▸ alpha"); // selection starts on the first widget

  // keyboard nav: move right to bravo, increment it (3 → 4)
  stdin.write("l");
  await tick();
  expect(lastFrame()).toContain("▸ bravo");
  stdin.write("i");
  await tick();
  expect(lastFrame()).toContain("= 4");

  // command bar: select alpha, then inc it by 5 (0 → 5)
  stdin.write(":");
  await tick();
  stdin.write("sel alpha");
  await tick();
  stdin.write("\r");
  await tick();
  expect(lastFrame()).toContain("▸ alpha");

  stdin.write(":");
  await tick();
  stdin.write("inc 5");
  await tick();
  stdin.write("\r");
  await tick();
  expect(lastFrame()).toContain("= 5");

  unmount();
});

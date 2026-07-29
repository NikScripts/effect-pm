import { render } from "ink-testing-library";
import { expect, it } from "vitest";
import { App } from "./grid-app";

const tick = () => new Promise((resolve) => setTimeout(resolve, 80));

it("renders a scrollable grid, moves selection, and runs commands", async () => {
  const { lastFrame, stdin, unmount } = render(<App />);
  await tick();

  const frame = lastFrame() ?? "";
  expect(frame).toContain("resource grid");
  expect(frame).toContain("w1");
  expect(frame).toContain("[:] command");
  expect(frame).toContain("▸ w1"); // selection starts on the first widget

  // keyboard nav: move right to w2
  stdin.write("l");
  await tick();
  expect(lastFrame()).toContain("▸ w2");

  // command bar: select w1, then inc it by 5 (0 → 5)
  stdin.write(":");
  await tick();
  stdin.write("sel w1");
  await tick();
  stdin.write("\r");
  await tick();
  expect(lastFrame()).toContain("▸ w1");

  stdin.write(":");
  await tick();
  stdin.write("inc 5");
  await tick();
  stdin.write("\r");
  await tick();
  expect(lastFrame()).toContain("= 5");

  unmount();
});

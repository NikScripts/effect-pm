import { render } from "ink-testing-library";
import { expect, it } from "vitest";
import { App } from "./counter-app";

const tick = () => new Promise((resolve) => setTimeout(resolve, 80));

it("renders a resource in the terminal and reacts to keypresses", async () => {
  const { lastFrame, stdin } = render(<App />);
  await tick();
  expect(lastFrame()).toContain("Counter — resource TUI");
  expect(lastFrame()).toContain("current:");
  expect(lastFrame()).toContain("0");

  stdin.write("i"); // increment by 1
  await tick();
  expect(lastFrame()).toContain("1");

  stdin.write("i");
  await tick();
  expect(lastFrame()).toContain("2");

  stdin.write("r"); // reset
  await tick();
  expect(lastFrame()).toContain("0");
});

import { expect, it } from "vitest";
import { render } from "../src/cli";

it("renders CLI output by value shape", () => {
  // void / nullish → ok
  expect(render(undefined)).toBe("ok");
  expect(render(null)).toBe("ok");

  // scalars → plain
  expect(render(0)).toBe("0");
  expect(render("hi")).toBe("hi");
  expect(render(true)).toBe("true");

  // arrays → one indented line each (empty → marker)
  expect(render(["jobs", "mail"])).toBe("  jobs\n  mail");
  expect(render([])).toBe("(empty)");

  // structs → aligned key / value
  expect(render({ id: "mail", pending: 2, paused: true })).toBe(
    "  id       mail\n  pending  2\n  paused   true",
  );
});

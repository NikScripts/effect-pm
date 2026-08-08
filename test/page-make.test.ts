/**
 * Page.make / Page.static — class brand + mode (no asDefault / configOf / getConfig).
 */
import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as Page from "last-ts/Page";

describe("Page.make", () => {
  it("dynamic by default", () => {
    class About extends Page.make() {}
    expect(Page.isPage(About)).toBe(true);
    expect(About.mode).toBe("dynamic");
    expect(About.options).toEqual({});
  });

  it("keeps request options (same bag as Route.get)", () => {
    const params = { slug: Schema.Literals(["routing", "view-service"]) };
    class Chapter extends Page.make({ params }) {}
    expect(Chapter.mode).toBe("dynamic");
    expect(Chapter.options.params).toBe(params);
  });

  it("Page.static opts into bake mode", () => {
    class Home extends Page.static() {}
    expect(Home.mode).toBe("static");
  });
});

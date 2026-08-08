/**
 * Page.make / Page.static — class brand + mode / options.
 */
import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as Page from "last-ts/Page";

describe("Page.make", () => {
  it("dynamic by default", () => {
    class About extends Page.make() {}
    expect(Page.isPage(About)).toBe(true);
    expect(Page.modeOf(About)).toBe("dynamic");
    expect(Page.optionsOf(About)).toEqual({});
  });

  it("keeps request options (same bag as Route.get)", () => {
    const params = { slug: Schema.Literals(["routing", "view-service"]) };
    class Chapter extends Page.make({ params }) {}
    expect(Page.modeOf(Chapter)).toBe("dynamic");
    expect(Page.optionsOf(Chapter).params).toBe(params);
  });

  it("Page.static opts into bake mode", () => {
    class Home extends Page.static() {}
    expect(Page.modeOf(Home)).toBe("static");
  });
});

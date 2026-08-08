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

  it("Page.extract reads class brand", () => {
    class Home extends Page.static() {
      static Component = () => null;
    }
    const extracted = Page.extract(Home);
    expect(extracted?.mode).toBe("static");
    expect(extracted?.Component).toBe(Home.Component);
  });

  it("Page.asDefault adapts Waku flat props into Page.Props", () => {
    const params = { slug: Schema.Literals(["routing", "view-service"]) };
    class Chapter extends Page.make({ params }) {
      static Component = (
        props: Page.PropsFromOptions<{ readonly params: typeof params }>,
      ) => {
        expect(props.params.slug).toBe("routing");
        expect(props.pathname).toBe("/guides/routing");
        return null;
      };
    }
    const Default = Page.asDefault(Chapter);
    expect(Page.isPage(Default)).toBe(true);
    expect(Page.modeOf(Default)).toBe("dynamic");
    Default({
      path: "/guides/routing",
      slug: "routing",
      query: "",
    } as never);
  });

  it("Page.configOf maps mode + Literals to Waku config", () => {
    class About extends Page.make() {}
    expect(Page.configOf(About)).toEqual({ render: "dynamic" });

    class Home extends Page.static() {}
    expect(Page.configOf(Home)).toEqual({ render: "static" });

    class Chapter extends Page.static({
      params: { slug: Schema.Literals(["routing", "view-service"]) },
    }) {}
    expect(Page.paramBagsOf(Chapter)).toEqual([
      { slug: "routing" },
      { slug: "view-service" },
    ]);
    expect(Page.configOf(Chapter)).toEqual({
      render: "static",
      staticPaths: ["routing", "view-service"],
    });
  });
});

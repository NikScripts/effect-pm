/**
 * Page.make / Page.static / Route.static — mint + mode + default.
 */
import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as React from "react";
import * as Page from "last-ts/Page";
import * as Route from "last-ts/Route";

describe("Page.make", () => {
  it("dynamic by default with JSX body", () => {
    class Home extends Page.make(React.createElement("h1", null, "Home")) {}
    expect(Page.isPage(Home)).toBe(true);
    expect(Home.mode).toBe("dynamic");
    expect(Home.options).toEqual({});
    expect(React.isValidElement(Home.default)).toBe(true);
  });

  it("keeps request options with Effect default", () => {
    const params = { slug: Schema.Literals(["routing", "view-service"]) };
    const chapter = Effect.succeed(React.createElement("h1", null, "ch"));
    class Chapter extends Page.make({ params }, chapter) {}
    expect(Chapter.mode).toBe("dynamic");
    expect(Chapter.options.params).toBe(params);
    expect(Effect.isEffect(Chapter.default)).toBe(true);
  });

  it("Page.static sugar sets bake mode", () => {
    class Pricing extends Page.static(
      React.createElement("h1", null, "Pricing"),
    ) {}
    expect(Pricing.mode).toBe("static");
  });

  it("Route.static pipes onto an existing class (camelCase const)", () => {
    class About extends Page.make(
      Effect.succeed(React.createElement("h1", null, "About")),
    ) {}
    const aboutStatic = About.pipe(Route.static);
    expect(aboutStatic.mode).toBe("static");
    expect(About.mode).toBe("dynamic");
    expect(Page.isPage(aboutStatic)).toBe(true);
  });
});

describe("RouterBuilder.handle Page mint", () => {
  it("unwraps Page.default as PageEffect", async () => {
    const { Layer, ManagedRuntime, pipe } = await import("effect");
    const Last = await import("last-ts/Last");
    const Layout = await import("last-ts/Layout");
    const Memory = await import("last-ts/Memory");
    const Router = await import("last-ts/Router");
    const RouterBuilder = await import("last-ts/RouterBuilder");

    class Home extends Page.make(
      Effect.succeed(React.createElement("span", { "data-page": "mint" }, "ok")),
    ) {}

    class Site extends Router.make("page-mint-site").add(
      Router.group("app").add(Route.get("home", "/")),
    ) {}

    class Shell extends Layout.make()(
      "test/page-mint/shell",
      Effect.sync(() => React.createElement(Layout.Outlet)),
    ) {}

    const routes = pipe(
      RouterBuilder.layer(Site),
      Layer.provide(
        pipe(
          RouterBuilder.group(Site, "app", (h) => h.handle("home", Home)),
          Layout.provide(Shell),
        ),
      ),
    );

    const rt = ManagedRuntime.make(routes);
    try {
      const registry = await rt.runPromise(
        Effect.gen(function* () {
          return yield* RouterBuilder.Registry;
        }),
      );
      expect(registry.groups.get("app")?.handlers.get("home")?._tag).toBe(
        "PageEffect",
      );
    } finally {
      await rt.dispose();
    }
    void Last;
    void Memory;
  });
});

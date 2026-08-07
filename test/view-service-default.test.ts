/**
 * View.Service(key, default) — Context.Reference slot; override via provideService.
 */
import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Layer } from "effect";
import * as React from "react";
import { renderToString } from "react-dom/server";
import * as View from "last-ts/View";

class Sidebar extends View.Service<Sidebar>()(
  "test/view-default/Sidebar",
  () => React.createElement("nav", { "data-sidebar": "default" }, "Menu"),
) {}

class Shell extends View.Service<Shell>()("test/view-default/Shell") {
  static layer = Layer.effect(
    Shell,
    Effect.gen(function* () {
      const Side = yield* Sidebar;
      return () =>
        React.createElement(
          "div",
          { "data-shell": "ok" },
          React.createElement(Side),
          React.createElement("main", null, "body"),
        );
    }),
  );
}

describe("View.Service default (Reference)", () => {
  it("yields the default component with no Layer for the slot", () => {
    const App = View.mount(Shell);
    const html = renderToString(React.createElement(App));
    expect(html).toContain("data-sidebar=\"default\"");
    expect(html).toContain("Menu");
    expect(html).toContain("data-shell=\"ok\"");
  });

  it("swaps the slot via Effect.provideService (nested settings chrome)", () => {
    class SettingsShell extends View.Service<SettingsShell>()(
      "test/view-default/SettingsShell",
    ) {
      static layer = Layer.effect(
        SettingsShell,
        Effect.gen(function* () {
          const Side = yield* Sidebar;
          return () =>
            React.createElement(
              "div",
              null,
              React.createElement(Side),
              React.createElement("main", null, "settings"),
            );
        }).pipe(
          Effect.provideService(
            Sidebar,
            () =>
              React.createElement(
                "nav",
                { "data-sidebar": "settings" },
                "Settings nav",
              ),
          ),
        ),
      );
    }

    const App = View.mount(SettingsShell);
    const html = renderToString(React.createElement(App));
    expect(html).toContain("data-sidebar=\"settings\"");
    expect(html).toContain("Settings nav");
    expect(html).not.toContain("data-sidebar=\"default\"");
  });

  it("swaps the slot via Layer.provideMerge (theme / section)", () => {
    // Reference is not in R — Layer.provide won't attach it; provideMerge does.
    class ThemedShell extends View.Service<ThemedShell>()(
      "test/view-default/ThemedShell",
    ) {
      static layer = Layer.effect(
        ThemedShell,
        Effect.gen(function* () {
          const Side = yield* Sidebar;
          return () =>
            React.createElement(
              "div",
              { "data-shell": "themed" },
              React.createElement(Side),
            );
        }),
      ).pipe(
        Layer.provideMerge(
          Layer.succeed(
            Sidebar,
            () =>
              React.createElement(
                "nav",
                { "data-sidebar": "theme" },
                "Themed",
              ),
          ),
        ),
      );
    }

    const App = View.mount(ThemedShell);
    const html = renderToString(React.createElement(App));
    expect(html).toContain("data-sidebar=\"theme\"");
    expect(html).toContain("Themed");
  });

  it("is a Context.Reference", () => {
    expect(Context.isReference(Sidebar)).toBe(true);
  });
});

/**
 * View.Service(key, default) — Sidebar slot + nested settings override.
 */
import * as React from "react";
import { Effect, Layer } from "effect";
import * as View from "last-ts/View";

class Sidebar extends View.Service<Sidebar>()(
  "docs/site/view-sidebar/Sidebar",
  () =>
    React.createElement(
      "nav",
      { "data-sidebar": "default", className: "text-xs text-muted-foreground" },
      "Default sidebar",
    ),
) {}

class Shell extends View.Service<Shell>()("docs/site/view-sidebar/Shell") {
  static layer = Layer.effect(
    Shell,
    Effect.gen(function* () {
      const Side = yield* Sidebar;
      return () =>
        React.createElement(
          "div",
          {
            "data-demo": "shell",
            className: "flex gap-3 border border-border rounded-lg p-3",
          },
          React.createElement(Side),
          React.createElement(
            "main",
            { className: "text-card-foreground" },
            "Page body",
          ),
        );
    }),
  );
}

class SettingsShell extends View.Service<SettingsShell>()(
  "docs/site/view-sidebar/SettingsShell",
) {
  static layer = Layer.effect(
    SettingsShell,
    Effect.gen(function* () {
      const Side = yield* Sidebar;
      return () =>
        React.createElement(
          "div",
          {
            "data-demo": "settings-shell",
            className: "flex gap-3 border border-border rounded-lg p-3",
          },
          React.createElement(Side),
          React.createElement(
            "main",
            { className: "text-card-foreground" },
            "Settings",
          ),
        );
    }).pipe(
      Effect.provideService(Sidebar, () =>
        React.createElement(
          "nav",
          {
            "data-sidebar": "settings",
            className: "text-xs font-medium text-card-foreground",
          },
          "Settings nav",
        ),
      ),
    ),
  );
}

/** Default sidebar (Reference default). */
export const DefaultApp = View.mount(Shell);

/** Nested settings chrome — Sidebar overridden for this tree. */
export const SettingsApp = View.mount(SettingsShell);

/**
 * View.make(key, default) — Sidebar slot + nested settings override.
 */
import * as React from "react";
import { Effect, Layer } from "effect";
import * as Last from "last-ts/Last";
import * as View from "last-ts/View";

class Sidebar extends View.make<Sidebar>()(
  "docs/site/view-sidebar/Sidebar",
  () =>
    React.createElement(
      "nav",
      { "data-sidebar": "default", className: "text-xs text-muted-foreground" },
      "Default sidebar",
    ),
) {}

class Shell extends View.make<Shell>()("docs/site/view-sidebar/Shell") {
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

class SettingsShell extends View.make<SettingsShell>()(
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
export const DefaultApp = View.stamp(Last.provide(Shell, Shell.layer));

/** Nested settings chrome — Sidebar overridden for this tree. */
export const SettingsApp = View.stamp(Last.provide(SettingsShell, SettingsShell.layer));

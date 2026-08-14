"use client";

/**
 * Client island — View.make(key, default) + provideService override.
 * Prefer `pipe(layer, Layer.provide(…))` over `layer.pipe(…)`.
 */
import * as React from "react";
import { Effect, Layer, pipe } from "effect";
import * as Last from "last-ts/Last";
import * as View from "last-ts/View";

class Sidebar extends View.make<Sidebar>()(
  "last-ts/docs/Sidebar",
  () => (
    <nav data-sidebar="default" className="slot-nav">
      <span className="slot-label">default</span>
      <p>View.make(key, default)</p>
    </nav>
  ),
) {}

class Shell extends View.make<Shell>()("last-ts/docs/Shell") {
  static layer = Layer.effect(
    Shell,
    Effect.gen(function* () {
      const Side = yield* Sidebar;
      return () => (
        <div data-demo="shell" className="slot-shell">
          <Side />
          <div className="slot-body">Page body</div>
        </div>
      );
    }),
  );
}

class SettingsShell extends View.make<SettingsShell>()(
  "last-ts/docs/SettingsShell",
) {
  static layer = pipe(
    Layer.effect(
      SettingsShell,
      Effect.gen(function* () {
        const Side = yield* Sidebar;
        return () => (
          <div data-demo="settings-shell" className="slot-shell">
            <Side />
            <div className="slot-body">Settings</div>
          </div>
        );
      }),
    ),
    Layer.provide(
      Layer.succeed(Sidebar, () => (
        <nav data-sidebar="settings" className="slot-nav settings">
          <span className="slot-label">override</span>
          <p>Effect.provideService(Sidebar, …)</p>
        </nav>
      )),
    ),
  );
}

const DefaultApp = View.stamp(Last.provide(Shell));
const SettingsApp = View.stamp(Last.provide(SettingsShell));

export function ViewDemo(): React.ReactElement {
  const [mode, setMode] = React.useState<"default" | "settings">("default");
  const App = mode === "settings" ? SettingsApp : DefaultApp;
  return (
    <div className="view-demo">
      <div className="toggle">
        <button
          type="button"
          className={mode === "default" ? "on" : undefined}
          onClick={() => setMode("default")}
        >
          default
        </button>
        <button
          type="button"
          className={mode === "settings" ? "on" : undefined}
          onClick={() => setMode("settings")}
        >
          settings override
        </button>
      </div>
      <App />
    </div>
  );
}

"use client";

/**
 * Live Sidebar slot — default vs settings override (`View.make` default).
 */
import * as React from "react";
import "../styles/widgets.css";
import { DefaultApp, SettingsApp } from "./view-sidebar-demo.js";

export function ViewSidebarIsland(): React.ReactElement {
  const [mode, setMode] = React.useState<"default" | "settings">("default");
  const App = mode === "settings" ? SettingsApp : DefaultApp;
  return (
    <div className="hl-dashboard grid gap-3 p-4 rounded-xl text-sm">
      <div className="flex items-center justify-between border-b border-border pb-2 gap-2">
        <span className="font-medium text-card-foreground">
          View.make(key, default)
        </span>
        <div className="flex gap-1">
          <button
            type="button"
            className={
              mode === "default"
                ? "text-xs px-2 py-1 rounded bg-muted text-card-foreground"
                : "text-xs px-2 py-1 rounded text-muted-foreground"
            }
            onClick={() => setMode("default")}
          >
            default
          </button>
          <button
            type="button"
            className={
              mode === "settings"
                ? "text-xs px-2 py-1 rounded bg-muted text-card-foreground"
                : "text-xs px-2 py-1 rounded text-muted-foreground"
            }
            onClick={() => setMode("settings")}
          >
            settings
          </button>
        </div>
      </div>
      <App />
    </div>
  );
}

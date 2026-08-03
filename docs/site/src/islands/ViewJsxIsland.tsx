"use client";

/**
 * Live render of View.mount(Outer, …) — bag-composed Hello → Middle → Outer.
 */
import * as React from "react";
import "../styles/widgets.css";
import { App } from "./view-typed-jsx-demo.js";

export function ViewJsxIsland(): React.ReactElement {
  return (
    <div className="hl-dashboard grid gap-3 p-4 rounded-xl text-sm">
      <div className="flex items-center justify-between border-b border-border pb-2">
        <span className="font-medium text-card-foreground">
          App = mount(Outer → Middle → Hello)
        </span>
        <span className="text-xs text-muted-foreground">live · View.mount</span>
      </div>
      <App />
    </div>
  );
}

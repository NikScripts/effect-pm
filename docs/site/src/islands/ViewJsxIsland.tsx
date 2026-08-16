"use client";

/**
 * Live render of `examples/ui/view-typed-jsx/App` — same SSOT as the Twoslash fences.
 */
import * as React from "react";
import "../styles/widgets.css";
import * as Demo from "../../../../examples/ui/view-typed-jsx/App.tsx";

export function ViewJsxIsland(): React.ReactElement {
  return (
    <div className="hl-dashboard grid gap-3 p-4 rounded-xl text-sm">
      <div className="flex items-center justify-between border-b border-border pb-2">
        <span className="font-medium text-card-foreground">
          App = Last.provide(AppRoot.AppRoot, AppRoot.appLayer)
        </span>
        <span className="text-xs text-muted-foreground">live · Last.provide</span>
      </div>
      <Demo.App />
    </div>
  );
}

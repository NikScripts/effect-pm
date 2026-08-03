"use client";

/**
 * Live demo: View.gen + last-ts jsx nested under a Radix Dialog wrapper.
 * Pair with Twoslash on `/docs/view-typed-jsx` for the type channel.
 */
/** @jsxImportSource last-ts */
import type * as React from "react";
import "../styles/widgets.css";
import * as AtomReact from "last-ts/AtomReact";
import { demoRuntime, Page } from "./view-typed-jsx-demo.js";

export function ViewJsxIsland(): React.ReactElement {
  return (
    <div className="hl-dashboard grid gap-3 p-4 rounded-xl text-sm">
      <div className="flex items-center justify-between border-b border-border pb-2">
        <span className="font-medium text-card-foreground">last-ts · typed JSX</span>
        <span className="text-xs text-muted-foreground">
          View.gen · Radix · RuntimeProvider
        </span>
      </div>
      <AtomReact.RegistryProvider>
        <AtomReact.RuntimeProvider runtime={demoRuntime as never}>
          <Page />
        </AtomReact.RuntimeProvider>
      </AtomReact.RegistryProvider>
      <p className="text-xs text-muted-foreground m-0">
        Hover the Twoslash block above for <code>PageNeeds</code> /{" "}
        <code>TreeNeeds</code> — should surface <code>Greeter | Clock</code>.
      </p>
    </div>
  );
}

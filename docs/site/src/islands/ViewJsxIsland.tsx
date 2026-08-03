"use client";

/**
 * Live render of Outer → … → Inner (same shape as the Twoslash block above).
 * Plain React JSX — no last-ts jsxImportSource on the client path.
 */
import * as React from "react";
import type { Atom } from "effect/unstable/reactivity";
import "../styles/widgets.css";
import * as AtomReact from "last-ts/AtomReact";
import { demoRuntime, Outer } from "./view-typed-jsx-demo.js";

export function ViewJsxIsland(): React.ReactElement {
  return (
    <div className="hl-dashboard grid gap-3 p-4 rounded-xl text-sm">
      <div className="flex items-center justify-between border-b border-border pb-2">
        <span className="font-medium text-card-foreground">
          Outer nests Inner
        </span>
        <span className="text-xs text-muted-foreground">live · RuntimeProvider</span>
      </div>
      <AtomReact.RegistryProvider>
        <AtomReact.RuntimeProvider
          runtime={demoRuntime as Atom.AtomRuntime<never>}
        >
          <Outer />
        </AtomReact.RuntimeProvider>
      </AtomReact.RegistryProvider>
    </div>
  );
}

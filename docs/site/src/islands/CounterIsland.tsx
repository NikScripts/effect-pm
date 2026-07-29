"use client";

// The base building block: a custom HyperService via `Hyperlink.Tag`, driven from buttons.
// The HyperService itself (contract + layer + atoms) lives in ./counter-hyperlink — declared
// once, so a content hot-edit that re-imports this entry can't re-register it. This file
// is just the UI. Tailwind scoped to .hl-dashboard.

import * as React from "react";
import "../styles/widgets.css";
import { AsyncResult } from "effect/unstable/reactivity";
import { RegistryProvider, useAtomValue, useAtomSet } from "hyperlink-ts/ui/atom-react";
import { countAtom, increment, reset } from "./counter-hyperlink.js";

function Panel(): React.ReactElement {
  const r = useAtomValue(countAtom);
  const count = AsyncResult.isSuccess(r) ? r.value : 0;
  const inc = useAtomSet(increment);
  const doReset = useAtomSet(reset);
  const [by, setBy] = React.useState(1);

  return (
    <div className="hl-dashboard grid gap-3 p-4 rounded-xl text-sm">
      <div className="flex items-center justify-between border-b border-border pb-2">
        <span className="font-medium text-card-foreground">docs/Counter</span>
        <span className="text-xs text-muted-foreground">Hyperlink.Tag · in your browser</span>
      </div>
      <div className="text-3xl font-semibold tabular-nums text-foreground">{count}</div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-muted-foreground">by</label>
        <input
          type="number"
          value={by}
          onChange={(e) => setBy(Number(e.target.value))}
          className="bg-card border rounded-md px-2 py-1 text-xs w-16"
        />
        <button type="button" onClick={() => inc(by)} className="rounded-md px-2.5 py-1 text-xs font-medium bg-primary text-primary-foreground">
          Increment
        </button>
        <button type="button" onClick={() => doReset(undefined)} className="rounded-md px-2.5 py-1 text-xs font-medium bg-secondary text-secondary-foreground">
          Reset
        </button>
      </div>
    </div>
  );
}

export function CounterIsland(): React.ReactElement {
  return (
    <RegistryProvider>
      <Panel />
    </RegistryProvider>
  );
}

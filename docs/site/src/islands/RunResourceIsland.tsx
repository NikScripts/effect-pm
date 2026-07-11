"use client";

// The most basic resource: a RunResource (a concurrency-gated effect you call on demand).
// Create it → run it from a button → watch the live in-flight count. No dashboard widget;
// live values read straight off the service's Subscribables. Tailwind scoped to .pm-dashboard.

import * as React from "react";
import "../styles/widgets.css";
import { AsyncResult } from "effect/unstable/reactivity";
import { RegistryProvider, useAtomValue, useAtomSet } from "@pm/ui/atom-react";
import { runFn, inFlightAtom } from "./double-resource.js";

const stat = (label: string, value: React.ReactNode) => (
  <span key={label} className="text-muted-foreground">
    {label} <b className="text-foreground tabular-nums">{value}</b>
  </span>
);

function Panel(): React.ReactElement {
  const runResult = useAtomValue(runFn);
  const inFlightR = useAtomValue(inFlightAtom);
  const run = useAtomSet(runFn);
  const [n, setN] = React.useState(21);

  const last = AsyncResult.isSuccess(runResult) ? String(runResult.value) : "—";
  const running = AsyncResult.isWaiting?.(runResult) ?? false;
  const inFlight = AsyncResult.isSuccess(inFlightR) ? inFlightR.value : 0;

  return (
    <div className="pm-dashboard grid gap-3 p-4 rounded-xl text-sm">
      <div className="flex items-center justify-between border-b border-border pb-2">
        <span className="font-medium text-card-foreground">docs/Double</span>
        <span className="text-xs text-muted-foreground">RunResource · concurrency 2 · in your browser</span>
      </div>
      <div className="flex flex-wrap gap-4 text-xs">
        {stat("last result", last)}
        {stat("in-flight", inFlight)}
        {stat("running", running ? "yes" : "no")}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="number"
          value={n}
          onChange={(e) => setN(Number(e.target.value))}
          className="bg-card border rounded-md px-2 py-1 text-xs w-20"
        />
        <button type="button" onClick={() => run(n)} className="rounded-md px-2.5 py-1 text-xs font-medium bg-primary text-primary-foreground">
          Run
        </button>
        <button
          type="button"
          onClick={() => { for (let i = 0; i < 5; i++) run(n + i); }}
          className="rounded-md px-2.5 py-1 text-xs font-medium bg-secondary text-secondary-foreground"
        >
          Run ×5 (watch the gate)
        </button>
      </div>
    </div>
  );
}

export function RunResourceIsland(): React.ReactElement {
  return (
    <RegistryProvider>
      <Panel />
    </RegistryProvider>
  );
}

/**
 * @module examples/resource-web/app
 *
 * The whole dashboard: point the shipped {@link Dashboard} at the hub. Every widget
 * (queues, processes, nested groups) is derived from each tag — this file hard-codes
 * nothing about the resources.
 */
import * as React from "react";
import { Dashboard, HostDots } from "../../src/web";
import { ServicesHub, runtime } from "./hub";

const DIE_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export const App = (): React.ReactElement => (
  // No header here — the Dashboard renders its own group breadcrumb (⬢ ServicesHub …).
  <div className="min-h-screen bg-background font-mono text-foreground">
    <Dashboard runtime={runtime} group={ServicesHub} />
    {/* dev preview: the host die at every count 1..9 — the dot shapes only (no live status). */}
    <div className="mx-auto mt-8 flex max-w-5xl flex-wrap items-end justify-center gap-8 border-t p-6 text-xs text-muted-foreground">
      {DIE_COUNTS.map((n) => (
        <div key={n} className="flex flex-col items-center gap-2">
          <HostDots count={n} />
          <span>{n}</span>
        </div>
      ))}
    </div>
  </div>
);

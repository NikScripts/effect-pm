"use client";

// Client island. Tailwind lives HERE (island code), never in a .md doc. The dashboard
// tokens are scoped to `.pm-dashboard`; the doc prose stays classless.
// (Placeholder body — the real dashboard QueueCard + LogStream swap in next.)

import * as React from "react";
import "../styles/widgets.css";

export function QueueIsland(): React.ReactElement {
  const [pending, setPending] = React.useState(0);
  const [done, setDone] = React.useState(0);

  React.useEffect(() => {
    const id = setInterval(() => {
      setPending((p) => {
        if (p <= 0) return 0;
        setDone((d) => d + 1);
        return p - 1;
      });
    }, 800);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="pm-dashboard p-4 rounded-lg text-sm">
      <div className="flex items-center justify-between border-b border-border pb-2 mb-3">
        <span className="font-medium text-card-foreground">Live island</span>
        <span className="text-xs text-muted-foreground">hydrated · Tailwind-scoped</span>
      </div>
      <div className="flex gap-3 items-center">
        <button
          type="button"
          onClick={() => setPending((p) => p + 1)}
          className="bg-primary text-primary-foreground rounded-md px-3 py-1 text-xs font-medium"
        >
          Enqueue
        </button>
        <span className="text-muted-foreground">pending <b className="text-foreground tabular-nums">{pending}</b></span>
        <span className="text-muted-foreground">completed <b className="text-foreground tabular-nums">{done}</b></span>
      </div>
    </div>
  );
}

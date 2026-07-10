"use client";

// Minimal client island — proves the Waku RSC server→client boundary in this app:
// the doc page is a server component; this hydrates and runs in the browser.
// (Placeholder interactivity; the real live QueueResource widget replaces the body next.)

import * as React from "react";

export function QueueIsland(): React.ReactElement {
  const [pending, setPending] = React.useState(0);
  const [done, setDone] = React.useState(0);

  // "worker": drains one pending item ~every 800ms so you can watch it move.
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
    <div data-island="queue-widget">
      <strong>Live island</strong> — hydrated & interactive (client component).
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginTop: "0.6rem" }}>
        <button type="button" onClick={() => setPending((p) => p + 1)}>Enqueue</button>
        <span>pending: {pending}</span>
        <span>completed: {done}</span>
      </div>
    </div>
  );
}

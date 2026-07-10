"use client";

// The real effect-pm dashboard widgets, observing a live QueueResource that runs in
// the browser. QueueStats/QueueControls/LogStream are the *universal* widgets (observe +
// controls common to every resource). Enqueue is type-specific, so it's a *custom* widget
// wired straight to the queue handle. Tailwind stays scoped to .pm-dashboard.

import * as React from "react";
import "../styles/widgets.css";
import { Effect } from "effect";
import { Atom } from "effect/unstable/reactivity";
import * as QueueResource from "@pm/QueueResource";
import { RegistryProvider, useAtomSet } from "@pm/ui/atom-react";
import { RuntimeProvider } from "@pm/web/runtime";
import { queueBundle } from "@pm/web/data";
import { QueueStats, QueueControls, LogStream } from "@pm/web/widgets";

class DocsQueue extends QueueResource.Service<DocsQueue, string, never>()("docs/DemoQueue", {
  concurrency: 1,
  // Run unpaused so enqueued items drain automatically (the universal controls are
  // pause/clear/shutdown — no resume — so a paused start would stick).
  effect: (item: string) =>
    Effect.gen(function* () {
      yield* Effect.logInfo(`processing "${item}"`);
      yield* Effect.sleep("1000 millis");
      yield* Effect.logInfo(`completed "${item}"`);
    }),
}) {}

const runtime = Atom.runtime(DocsQueue.layer);
// The queue tag *is* the observable service the widgets read (status/metrics/logs).
const bundle = queueBundle(runtime, DocsQueue as never);

// custom control — the universal widgets can't add to a queue; wire it to the handle.
const enqueue = runtime.fn(
  (p: { readonly text: string; readonly priority: "normal" | "high" | "low" }) =>
    Effect.flatMap(DocsQueue, (q) =>
      p.priority === "high" ? q.prioritize(p.text) : p.priority === "low" ? q.defer(p.text) : q.add(p.text),
    ),
);

function CustomEnqueue(): React.ReactElement {
  const add = useAtomSet(enqueue);
  const [text, setText] = React.useState("");
  const [priority, setPriority] = React.useState<"normal" | "high" | "low">("normal");
  const submit = (): void => {
    const t = text.trim();
    if (t.length > 0) {
      add({ text: t, priority });
      setText("");
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        placeholder="item…"
        className="bg-card border rounded-md px-2 py-1 text-xs"
      />
      <select
        value={priority}
        onChange={(e) => setPriority(e.target.value as "normal" | "high" | "low")}
        className="bg-card border rounded-md px-1 py-1 text-xs"
      >
        <option value="high">high</option>
        <option value="normal">normal</option>
        <option value="low">low</option>
      </select>
      <button type="button" onClick={submit} className="bg-primary text-primary-foreground rounded-md px-2.5 py-1 text-xs font-medium">
        Enqueue (custom)
      </button>
    </div>
  );
}

export function QueueIsland(): React.ReactElement {
  return (
    <RegistryProvider>
      <RuntimeProvider runtime={runtime}>
        <div className="pm-dashboard grid gap-3 p-4 rounded-xl text-sm">
          <div className="text-xs text-muted-foreground">docs/DemoQueue — live in your browser</div>
          <QueueStats bundle={bundle} />
          <QueueControls bundle={bundle} />
          <CustomEnqueue />
          <div>
            <div className="text-xs text-muted-foreground mb-1">live logs</div>
            <LogStream bundle={bundle} className="h-40 bg-card border rounded-md" />
          </div>
        </div>
      </RuntimeProvider>
    </RegistryProvider>
  );
}

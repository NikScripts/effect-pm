"use client";

// A no-widget prototype: a real QueueResource running in the browser, with a hand-wired
// control panel — live stats read straight off the current `status` stream, buttons that
// call the handle. No dashboard widgets (those wait on the web-ui-refresh fix); this shows
// the raw "create → use → control a resource" pattern. Tailwind scoped to .pm-dashboard.

import * as React from "react";
import "../styles/widgets.css";
import { Effect, Stream } from "effect";
import { Atom, AsyncResult } from "effect/unstable/reactivity";
import * as QueueResource from "@pm/QueueResource";
import { RegistryProvider, useAtomValue, useAtomSet } from "@pm/ui/atom-react";

class DemoQueue extends QueueResource.Service<DemoQueue, string, never>()("docs/DemoQueue", {
  concurrency: 1,
  effect: (item: string) =>
    Effect.gen(function* () {
      yield* Effect.logInfo(`processing "${item}"`);
      yield* Effect.sleep("1000 millis");
    }),
}) {}

const runtime = Atom.runtime(DemoQueue.layer);

// live stats: subscribe to the queue's `status` stream (a bare Stream on the service).
const statusAtom = runtime.atom(Stream.unwrap(Effect.map(DemoQueue, (q) => q.status)));

// controls: each is just a handle method run through the runtime.
const enqueue = runtime.fn((p: { readonly text: string; readonly priority: "normal" | "high" | "low" }) =>
  Effect.flatMap(DemoQueue, (q) =>
    p.priority === "high" ? q.prioritize(p.text) : p.priority === "low" ? q.defer(p.text) : q.add(p.text),
  ),
);
const pause = runtime.fn(() => Effect.flatMap(DemoQueue, (q) => q.pause));
const resume = runtime.fn(() => Effect.flatMap(DemoQueue, (q) => q.resume));
const clear = runtime.fn(() => Effect.flatMap(DemoQueue, (q) => q.clear));

const btn = "rounded-md px-2.5 py-1 text-xs font-medium bg-secondary text-secondary-foreground";
const stat = (label: string, value: number | string) => (
  <span key={label} className="text-muted-foreground">
    {label} <b className="text-foreground tabular-nums">{value}</b>
  </span>
);

function Panel(): React.ReactElement {
  const r = useAtomValue(statusAtom);
  const s = AsyncResult.isSuccess(r) ? (r.value as any) : undefined;
  const sizes = s?.sizes ?? { high: 0, normal: 0, low: 0 };
  const pending = sizes.high + sizes.normal + sizes.low;

  const add = useAtomSet(enqueue);
  const doPause = useAtomSet(pause);
  const doResume = useAtomSet(resume);
  const doClear = useAtomSet(clear);
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
    <div className="pm-dashboard grid gap-3 p-4 rounded-xl text-sm">
      <div className="flex items-center justify-between border-b border-border pb-2">
        <span className="font-medium text-card-foreground">docs/DemoQueue</span>
        <span className="text-xs text-muted-foreground">{s?.paused ? "paused" : s?.phase ?? "running"} · in your browser</span>
      </div>
      <div className="flex flex-wrap gap-4 text-xs">
        {stat("pending", pending)}
        {stat("high", sizes.high)}
        {stat("normal", sizes.normal)}
        {stat("low", sizes.low)}
        {stat("in-flight", s?.inFlight ?? 0)}
        {stat("completed", s?.completed ?? 0)}
      </div>
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
        <button type="button" onClick={submit} className="rounded-md px-2.5 py-1 text-xs font-medium bg-primary text-primary-foreground">Enqueue</button>
        <button type="button" onClick={() => doPause(undefined)} className={btn}>Pause</button>
        <button type="button" onClick={() => doResume(undefined)} className={btn}>Resume</button>
        <button type="button" onClick={() => doClear(undefined)} className={btn}>Clear</button>
      </div>
    </div>
  );
}

export function QueueIsland(): React.ReactElement {
  return (
    <RegistryProvider>
      <Panel />
    </RegistryProvider>
  );
}

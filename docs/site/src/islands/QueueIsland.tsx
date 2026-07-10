"use client";

// A real effect-pm QueueResource running in the browser, with its Effect.log output
// captured live into the dashboard's LogStream widget. Tailwind lives here (island
// code, scoped to .pm-dashboard), never in a .md doc.

import * as React from "react";
import "../styles/widgets.css";
import { Effect, Layer, Logger, PubSub, Stream } from "effect";
import { Atom, AsyncResult, Reactivity } from "effect/unstable/reactivity";
import * as QueueResource from "@pm/QueueResource";
import { RegistryProvider, useAtomValue, useAtomSet } from "@pm/ui/atom-react";

// A copy of the shipped dashboard `LogStream` (src/web/widgets.tsx) — inlined so we
// don't import that module, which transitively drags Node-only code (recharts/runtime
// chain) into the browser bundle. De-dupe once web/widgets is split browser-safe.
interface LogLine {
  readonly id: number;
  readonly t: number;
  readonly level: string;
  readonly message: string;
}
const LEVEL: Record<string, string> = {
  info: "#7dd3fc",
  warning: "#fbbf24",
  warn: "#fbbf24",
  error: "#f87171",
  debug: "#a3a3a3",
  trace: "#a3a3a3",
};
const fmtClock = (t: number): string => {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const LogStream = (props: {
  readonly bundle: { readonly logs: Atom.Atom<AsyncResult.AsyncResult<ReadonlyArray<LogLine>, unknown>> };
  readonly className?: string;
}): React.ReactElement => {
  const r = useAtomValue(props.bundle.logs);
  const logs: ReadonlyArray<LogLine> = AsyncResult.isSuccess(r) ? r.value : [];
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [logs.length]);
  return (
    <div ref={ref} className={`overflow-auto text-xs ${props.className ?? ""}`}>
      {logs.length === 0 ? (
        <div className="px-2 py-1 text-muted-foreground">no logs yet — enqueue and Start</div>
      ) : (
        logs.map((l) => (
          <div key={l.id} className="flex gap-2 px-2 py-0.5">
            <span className="w-16 shrink-0 whitespace-nowrap tabular-nums text-muted-foreground">{fmtClock(l.t)}</span>
            <span className="w-12 shrink-0 truncate" style={{ color: LEVEL[l.level] ?? "#cbd5e1" }}>{l.level}</span>
            <span className="break-all">{l.message}</span>
          </div>
        ))
      )}
    </div>
  );
};

const StatsKey = ["docs-demo-queue"] as const;

// ── capture Effect logs → PubSub → a stream atom → the real LogStream widget ──
const logHub = Effect.runSync(PubSub.unbounded<LogLine>());
let logId = 0;
const renderMessage = (m: unknown): string =>
  Array.isArray(m) ? m.map((x) => String(x)).join(" ") : String(m);
const captureLogger = Logger.make((opts: any) => {
  const line: LogLine = {
    id: logId++,
    t: opts?.date instanceof Date ? opts.date.getTime() : Date.now(),
    level: String(opts?.logLevel?.label ?? "info").toLowerCase(),
    message: renderMessage(opts?.message),
  };
  Effect.runFork(PubSub.publish(logHub, line)); // fire-and-forget; unbounded never blocks
});
const captureLayer = Logger.layer([captureLogger]);

// ── the demo queue: a real QueueResource, logs straight from its handler ──
class DocsQueue extends QueueResource.Service<DocsQueue, string, never>()("docs/DemoQueue", {
  concurrency: 1,
  paused: true, // enqueue accumulates; press Start to drain
  effect: (item: string) =>
    Effect.gen(function* () {
      yield* Effect.logInfo(`processing "${item}"`);
      yield* Effect.sleep("1000 millis");
      yield* Effect.logInfo(`completed "${item}"`);
      yield* Reactivity.invalidate(StatsKey);
    }),
}) {}

const runtime = Atom.runtime(Layer.provideMerge(DocsQueue.layer, captureLayer));

const statsAtom = Atom.withReactivity(StatsKey)(
  runtime.atom(
    Effect.gen(function* () {
      const q = yield* DocsQueue;
      return { size: yield* q.size, sizes: yield* q.sizes, completed: yield* q.completed };
    }),
  ),
);
const logsAtom = runtime.atom(
  Stream.fromPubSub(logHub).pipe(
    Stream.scan([] as ReadonlyArray<LogLine>, (acc, line) => [...acc, line].slice(-200)),
  ),
);

const keyed = { reactivityKeys: StatsKey };
const enqueue = runtime.fn(
  (p: { readonly text: string; readonly priority: "normal" | "high" | "low" }) =>
    Effect.flatMap(DocsQueue, (q) =>
      p.priority === "high" ? q.prioritize(p.text) : p.priority === "low" ? q.defer(p.text) : q.add(p.text),
    ),
  keyed,
);
const start = runtime.fn(() => Effect.flatMap(DocsQueue, (q) => q.start), keyed);
const pause = runtime.fn(() => Effect.flatMap(DocsQueue, (q) => q.pause), keyed);
const resume = runtime.fn(() => Effect.flatMap(DocsQueue, (q) => q.resume), keyed);
const clear = runtime.fn(() => Effect.flatMap(DocsQueue, (q) => q.clear), keyed);

const btn = "rounded-md px-2.5 py-1 text-xs font-medium";
const secondary = `${btn} bg-secondary text-secondary-foreground`;

function Connected(): React.ReactElement {
  const statsR = useAtomValue(statsAtom);
  const s = AsyncResult.isSuccess(statsR) ? statsR.value : undefined;
  const add = useAtomSet(enqueue);
  const doStart = useAtomSet(start);
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
    <div className="pm-dashboard grid gap-3 p-4 rounded-lg text-sm">
      <div className="flex items-center justify-between border-b border-border pb-2">
        <span className="font-medium text-card-foreground">docs/DemoQueue</span>
        <span className="text-xs text-muted-foreground">live · runs in your browser</span>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder="item…"
          className="bg-card border border-border rounded-md px-2 py-1 text-xs"
        />
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as "normal" | "high" | "low")}
          className="bg-card border border-border rounded-md px-1 py-1 text-xs"
        >
          <option value="high">high</option>
          <option value="normal">normal</option>
          <option value="low">low</option>
        </select>
        <button type="button" onClick={submit} className={`${btn} bg-primary text-primary-foreground`}>Enqueue</button>
        <button type="button" onClick={() => doStart(undefined)} className={secondary}>Start</button>
        <button type="button" onClick={() => doPause(undefined)} className={secondary}>Pause</button>
        <button type="button" onClick={() => doResume(undefined)} className={secondary}>Resume</button>
        <button type="button" onClick={() => doClear(undefined)} className={secondary}>Clear</button>
      </div>
      <div className="flex gap-4 text-xs text-muted-foreground">
        <span>pending <b className="text-foreground tabular-nums">{s?.size ?? 0}</b></span>
        <span>high <b className="text-foreground tabular-nums">{s?.sizes.high ?? 0}</b></span>
        <span>normal <b className="text-foreground tabular-nums">{s?.sizes.normal ?? 0}</b></span>
        <span>low <b className="text-foreground tabular-nums">{s?.sizes.low ?? 0}</b></span>
        <span>completed <b className="text-foreground tabular-nums">{s?.completed ?? 0}</b></span>
      </div>
      <div>
        <div className="text-xs text-muted-foreground mb-1">live logs (Effect.log from the handler)</div>
        <LogStream bundle={{ logs: logsAtom }} className="h-40 bg-card border border-border rounded-md" />
      </div>
    </div>
  );
}

export function QueueIsland(): React.ReactElement {
  return (
    <RegistryProvider>
      <Connected />
    </RegistryProvider>
  );
}

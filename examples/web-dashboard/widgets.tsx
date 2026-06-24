/**
 * @module examples/web-dashboard/widgets
 *
 * Shared queue widgets — the same building blocks render on mobile and desktop, only
 * the page layout differs. Each reads its data straight from the `live-queues` atoms.
 */

import * as React from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AsyncResult } from "effect/unstable/reactivity";
import {
  type Group,
  type LogLine,
  type MetricPoint,
  type Node,
  type QueueBundle,
  REGISTRY,
} from "../resource-tui/live-queues";
import { useAtomValue } from "../queue-widget/atom-react";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent } from "./components/ui/card";
import { cn } from "./lib/utils";

export const displayName = (key: string): string => key.split("/").pop() ?? key;
export const fmtMs = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;
export const leafIds = (g: Group): ReadonlyArray<string> =>
  g.members.flatMap((m) => (m.t === "g" ? leafIds(m) : [m.name]));

export const STATUS: Record<string, { label: string; color: string }> = {
  running: { label: "running", color: "#22c55e" },
  paused: { label: "paused", color: "#eab308" },
  draining: { label: "draining", color: "#06b6d4" },
  off: { label: "off", color: "#ef4444" },
};
export const statusKey = (phase: string, paused: boolean): string =>
  phase === "off" ? "off" : phase === "draining" ? "draining" : paused ? "paused" : "running";

const PRIO = {
  high: "#ef4444",
  normal: "#94a3b8",
  low: "#3b82f6",
} as const;
const LEVEL: Record<string, string> = {
  Info: "#cbd5e1",
  Warning: "#eab308",
  Error: "#ef4444",
  Fatal: "#ef4444",
};

export const StatusBadge = (props: {
  readonly phase: string;
  readonly paused: boolean;
}): React.ReactElement => {
  const s = STATUS[statusKey(props.phase, props.paused)] ?? STATUS.running!;
  return <Badge color={s.color}>{s.label}</Badge>;
};

const Bar = (props: { readonly value: number; readonly max: number; readonly color: string }): React.ReactElement => (
  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
    <div
      className="h-full rounded-full"
      style={{ width: `${props.max <= 0 ? 0 : Math.min(100, (props.value / props.max) * 100)}%`, background: props.color }}
    />
  </div>
);

const PrioRow = (props: { readonly p: keyof typeof PRIO; readonly count: number; readonly max: number }): React.ReactElement => (
  <div className="flex items-center gap-2">
    <span className="w-12 text-xs" style={{ color: PRIO[props.p] }}>{props.p}</span>
    <Bar value={props.count} max={props.max} color={PRIO[props.p]} />
    <span className="w-8 text-right text-xs">{props.count}</span>
  </div>
);

/** A queue as a grid card (mobile cards + desktop card view). Reads its own status. */
export const QueueCard = (props: {
  readonly id: string;
  readonly bundle: QueueBundle;
  readonly selected?: boolean;
  readonly onOpen: (id: string) => void;
}): React.ReactElement => {
  const r = useAtomValue(props.bundle.status);
  const s = AsyncResult.isSuccess(r) ? r.value : undefined;
  const sizes = s?.sizes ?? { high: 0, normal: 0, low: 0 };
  const pending = sizes.high + sizes.normal + sizes.low;
  const max = Math.max(sizes.high, sizes.normal, sizes.low, 1);
  return (
    <button
      type="button"
      onClick={() => props.onOpen(props.id)}
      className={cn(
        "rounded-xl border bg-card p-3 text-left transition-colors hover:border-ring",
        props.selected === true && "border-primary",
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <strong className="flex-1 truncate">{displayName(props.id)}</strong>
        <StatusBadge phase={s?.phase ?? "running"} paused={s?.paused ?? false} />
      </div>
      <div className="mb-2 flex justify-between text-xs text-muted-foreground">
        <span>pending <strong className="text-foreground">{pending}</strong></span>
        <span>{s?.completed ?? 0} done</span>
      </div>
      <div className="flex flex-col gap-1">
        <PrioRow p="high" count={sizes.high} max={max} />
        <PrioRow p="normal" count={sizes.normal} max={max} />
        <PrioRow p="low" count={sizes.low} max={max} />
      </div>
    </button>
  );
};

const MemberRow = (props: { readonly id: string; readonly bundle: QueueBundle }): React.ReactElement => {
  const r = useAtomValue(props.bundle.status);
  const s = AsyncResult.isSuccess(r) ? r.value : undefined;
  const sk = statusKey(s?.phase ?? "running", s?.paused ?? false);
  const pending = s === undefined ? 0 : s.sizes.high + s.sizes.normal + s.sizes.low;
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="size-2 shrink-0 rounded-full" style={{ background: STATUS[sk]?.color }} />
      <span className="flex-1 truncate">{displayName(props.id)}</span>
      <span className="text-foreground">{pending}</span>
    </div>
  );
};

/** A subgroup as a grid widget — tap opens it as its own page (mobile drill-down). */
export const GroupCard = (props: {
  readonly node: Group;
  readonly onOpen: (g: Group) => void;
}): React.ReactElement => {
  const queues = props.node.members.filter((n) => n.t === "q").slice(0, 4);
  const subs = props.node.members.filter((n): n is Group => n.t === "g");
  return (
    <button
      type="button"
      onClick={() => props.onOpen(props.node)}
      className="rounded-xl border border-[#06b6d455] bg-card p-3 text-left transition-colors hover:border-ring"
    >
      <div className="mb-2 flex items-center gap-2">
        <strong className="flex-1 truncate text-[#06b6d4]">▸ {displayName(props.node.name)}</strong>
        <span className="text-xs text-muted-foreground">{leafIds(props.node).length} queues</span>
      </div>
      <div className="flex flex-col gap-1">
        {queues.map((q) => {
          const b = REGISTRY[q.name];
          return b === undefined ? null : <MemberRow key={q.name} id={q.name} bundle={b} />;
        })}
        {subs.map((sg) => (
          <div key={sg.name} className="text-xs text-[#06b6d4]">▸ {displayName(sg.name)}</div>
        ))}
      </div>
      <div className="mt-2 text-xs text-muted-foreground">tap to open →</div>
    </button>
  );
};

export const Cell = (props: {
  readonly node: Node;
  readonly onOpenQueue: (id: string) => void;
  readonly onOpenGroup: (g: Group) => void;
}): React.ReactElement | null => {
  if (props.node.t === "g") {
    return <GroupCard node={props.node} onOpen={props.onOpenGroup} />;
  }
  const b = REGISTRY[props.node.name];
  return b === undefined ? null : <QueueCard id={props.node.name} bundle={b} onOpen={props.onOpenQueue} />;
};

export const Stat = (props: { readonly label: string; readonly value: string }): React.ReactElement => (
  <Card className="flex-1">
    <CardContent className="p-3">
      <div className="text-xs text-muted-foreground">{props.label}</div>
      <div className="text-lg text-foreground">{props.value}</div>
    </CardContent>
  </Card>
);

/** Stat cards from the live status + metrics. */
export const QueueStats = (props: { readonly bundle: QueueBundle }): React.ReactElement => {
  const statusR = useAtomValue(props.bundle.status);
  const metricsR = useAtomValue(props.bundle.metrics);
  const s = AsyncResult.isSuccess(statusR) ? statusR.value : undefined;
  const m = AsyncResult.isSuccess(metricsR) ? metricsR.value : undefined;
  const sizes = s?.sizes ?? { high: 0, normal: 0, low: 0 };
  return (
    <div className="flex flex-wrap gap-2">
      <Stat label="pending" value={String(sizes.high + sizes.normal + sizes.low)} />
      <Stat label="in-flight" value={String(s?.inFlight ?? 0)} />
      <Stat label="done" value={String(s?.completed ?? 0)} />
      <Stat label="thr/s" value={(m?.throughputPerSec ?? 0).toFixed(1)} />
      <Stat label="latency" value={fmtMs(m?.avgTotalMillis ?? 0)} />
    </div>
  );
};

/** Throughput area chart from the metrics history series. */
export const ThroughputChart = (props: { readonly bundle: QueueBundle }): React.ReactElement => {
  const r = useAtomValue(props.bundle.history);
  const history = (AsyncResult.isSuccess(r) ? r.value : []) as Array<MetricPoint>;
  return (
    <ResponsiveContainer width="100%" height={140}>
      <AreaChart data={history}>
        <defs>
          <linearGradient id="thr" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22c55e" stopOpacity={0.5} />
            <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="t" hide />
        <YAxis hide />
        <Tooltip contentStyle={{ background: "#1e2636", border: "1px solid #2b3650", borderRadius: 8, fontSize: 12 }} />
        <Area
          type="monotone"
          dataKey="throughput"
          stroke="#22c55e"
          fill="url(#thr)"
          strokeWidth={2}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
};

export const QueueControls = (props: { readonly bundle: QueueBundle }): React.ReactElement => (
  <div className="flex flex-wrap gap-2">
    <Button variant="outline" size="sm" onClick={() => props.bundle.pause()}>pause</Button>
    <Button variant="outline" size="sm" onClick={() => props.bundle.resume()}>resume</Button>
    <Button variant="outline" size="sm" onClick={() => props.bundle.clear()}>clear</Button>
    <Button variant="destructive" size="sm" onClick={() => props.bundle.shutdown()}>shutdown</Button>
  </div>
);

/** The live log stream (auto-scrolls to newest). */
export const LogStream = (props: { readonly bundle: QueueBundle; readonly className?: string }): React.ReactElement => {
  const r = useAtomValue(props.bundle.logs);
  const logs = AsyncResult.isSuccess(r) ? r.value : [];
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (el !== null) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logs.length]);
  return (
    <div ref={ref} className={cn("overflow-auto text-xs", props.className)}>
      {logs.map((l: LogLine) => (
        <div key={l.id} className="flex gap-2 px-2 py-0.5">
          <span className="w-20 shrink-0 text-muted-foreground">{new Date(l.t).toLocaleTimeString()}</span>
          <span className="w-14 shrink-0" style={{ color: LEVEL[l.level] ?? "#cbd5e1" }}>{l.level}</span>
          <span className="break-all">{l.message}</span>
        </div>
      ))}
    </div>
  );
};

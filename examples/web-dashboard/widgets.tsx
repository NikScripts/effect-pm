/**
 * @module examples/web-dashboard/widgets
 *
 * Shared queue widgets — same building blocks on mobile and desktop. Each is driven
 * by a **tag** (its bundle comes from `queueBundle(tag)`); the tree is a `Group.Tag`
 * walked with `Group.members` / `Group.isGroup`. No `REGISTRY`, no `TREE`.
 */

import * as React from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AsyncResult } from "effect/unstable/reactivity";
import { Group } from "../../src/Group";
import {
  type CommandAtom,
  type GroupNode,
  type LeafTag,
  type LogLine,
  type MetricPoint,
  type ProcessBundle,
  type ProcessTag,
  type QueueBundle,
  hostOf,
  kindOf,
  leafTags,
  processBundle,
  queueBundle,
  queueLeaves,
} from "./queue-data";
import { useAtomSet, useAtomValue } from "../../src/ui/atom-react";
import { useViewTransitionStyle } from "../../src/web/useViewTransition";
import { dlog } from "./debug-console";

/** A short label for an AsyncResult, for debug logging. */
const asyncTag = (r: AsyncResult.AsyncResult<unknown, unknown>): string =>
  AsyncResult.isSuccess(r)
    ? `Success${Array.isArray(r.value) ? `(${r.value.length})` : ""}`
    : AsyncResult.isFailure(r)
      ? "Failure"
      : AsyncResult.isWaiting(r)
        ? "Waiting"
        : "Initial";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent } from "./components/ui/card";
import { cn } from "./lib/utils";
import { Lock, LockOpen, Pause, Play, Power, RotateCw, Square, Trash2 } from "lucide-react";

export const displayName = (key: string): string => key.split("/").pop() ?? key;
export const fmtMs = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

export const STATUS: Record<string, { label: string; color: string }> = {
  running: { label: "running", color: "#22c55e" },
  paused: { label: "paused", color: "#eab308" },
  draining: { label: "draining", color: "#06b6d4" },
  off: { label: "off", color: "#ef4444" },
};
export const statusKey = (phase: string, paused: boolean): string =>
  phase === "off" ? "off" : phase === "draining" ? "draining" : paused ? "paused" : "running";

const PRIO = { high: "#ef4444", normal: "#94a3b8", low: "#3b82f6" } as const;
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

/** A queue as a grid card. Reads its own status straight from the tag. */
export const QueueCard = (props: {
  readonly tag: LeafTag;
  readonly selected?: boolean;
  readonly onOpen: (tag: LeafTag) => void;
}): React.ReactElement => {
  const vt = useViewTransitionStyle(`res-${props.tag.id}`);
  const r = useAtomValue(queueBundle(props.tag).status);
  const s = AsyncResult.isSuccess(r) ? r.value : undefined;
  const sizes = s?.sizes ?? { high: 0, normal: 0, low: 0 };
  const pending = sizes.high + sizes.normal + sizes.low;
  const max = Math.max(sizes.high, sizes.normal, sizes.low, 1);
  return (
    <button
      type="button"
      onClick={() => props.onOpen(props.tag)}
      style={vt}
      className={cn(
        "rounded-xl border bg-card p-3 text-left transition-colors hover:border-ring",
        props.selected === true && "border-primary",
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <strong className="flex-1 truncate">{displayName(props.tag.id)}</strong>
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

const MemberRow = (props: { readonly tag: LeafTag }): React.ReactElement => {
  const r = useAtomValue(queueBundle(props.tag).status);
  const s = AsyncResult.isSuccess(r) ? r.value : undefined;
  const sk = statusKey(s?.phase ?? "running", s?.paused ?? false);
  const pending = s === undefined ? 0 : s.sizes.high + s.sizes.normal + s.sizes.low;
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="size-2 shrink-0 rounded-full" style={{ background: STATUS[sk]?.color }} />
      <span className="flex-1 truncate">{displayName(props.tag.id)}</span>
      <span className="text-foreground">{pending}</span>
    </div>
  );
};

/** A subgroup as a grid widget — tap opens it as its own page (drill-down). */
export const GroupCard = (props: {
  readonly node: GroupNode;
  readonly onOpen: (g: GroupNode) => void;
}): React.ReactElement => {
  const vt = useViewTransitionStyle(`grp-${props.node.id}`);
  const members = Object.values(Group.members(props.node));
  const leaves = queueLeaves(props.node).slice(0, 4);
  const subs = members.filter((m): m is GroupNode => Group.isGroup(m));
  return (
    <button
      type="button"
      onClick={() => props.onOpen(props.node)}
      style={vt}
      className="rounded-xl border border-[#06b6d455] bg-card p-3 text-left transition-colors hover:border-ring"
    >
      <div className="mb-2 flex items-center gap-2">
        <strong className="flex-1 truncate text-[#06b6d4]">▸ {displayName(props.node.id)}</strong>
        <span className="text-xs text-muted-foreground">{leafTags(props.node).length} resources</span>
      </div>
      <div className="flex flex-col gap-1">
        {leaves.map((tag) => <MemberRow key={tag.id} tag={tag} />)}
        {subs.map((sg) => (
          <div key={sg.id} className="text-xs text-[#06b6d4]">▸ {displayName(sg.id)}</div>
        ))}
      </div>
      <div className="mt-2 text-xs text-muted-foreground">tap to open →</div>
    </button>
  );
};

export const Cell = (props: {
  readonly member: unknown;
  readonly onOpenLeaf: (tag: LeafTag | ProcessTag) => void;
  readonly onOpenGroup: (g: GroupNode) => void;
}): React.ReactElement => {
  if (Group.isGroup(props.member)) {
    return <GroupCard node={props.member} onOpen={props.onOpenGroup} />;
  }
  return kindOf(props.member) === "process" ? (
    <ProcessCard tag={props.member as ProcessTag} onOpen={props.onOpenLeaf} />
  ) : (
    <QueueCard tag={props.member as LeafTag} onOpen={props.onOpenLeaf} />
  );
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
  React.useEffect(() => dlog("status", asyncTag(statusR), "· metrics", asyncTag(metricsR)), [statusR, metricsR]);
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

const METRICS = {
  throughput: { label: "throughput /s", color: "#22c55e", source: "history" as const },
  latency: { label: "latency (s)", color: "#eab308", source: "history" as const },
  pending: { label: "pending", color: "#3b82f6", source: "trend" as const },
};
type MetricKey = keyof typeof METRICS;

/** A metric chart with a dropdown to pick the series (throughput/latency/pending). */
export const MetricChart = (props: { readonly bundle: QueueBundle }): React.ReactElement => {
  const [metric, setMetric] = React.useState<MetricKey>("throughput");
  const historyR = useAtomValue(props.bundle.history);
  const trendR = useAtomValue(props.bundle.trend);
  React.useEffect(() => dlog("history", asyncTag(historyR), "· trend", asyncTag(trendR)), [historyR, trendR]);
  const history: ReadonlyArray<MetricPoint> = AsyncResult.isSuccess(historyR) ? historyR.value : [];
  const trend: ReadonlyArray<number> = AsyncResult.isSuccess(trendR) ? trendR.value : [];
  const def = METRICS[metric];
  const data =
    def.source === "trend"
      ? trend.map((v, i) => ({ i, value: v }))
      : history.map((p, i) => ({ i, value: metric === "latency" ? p.latency / 1000 : p.throughput }));
  return (
    <div>
      <select
        value={metric}
        onChange={(e) => setMetric(e.target.value as MetricKey)}
        className="mb-2 rounded-md border bg-card px-2 py-1 text-sm font-semibold text-foreground"
      >
        {(Object.keys(METRICS) as Array<MetricKey>).map((k) => (
          <option key={k} value={k}>
            {METRICS[k].label}
          </option>
        ))}
      </select>
      {/* fixed-height wrapper + height="100%": a percentage-sized ResponsiveContainer in a
          content-sized flex parent grows on every measure tick (the chart can balloon to
          thousands of px, esp. in landscape) — pinning the parent height breaks the loop. */}
      <div className="h-[140px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id={`g-${metric}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={def.color} stopOpacity={0.5} />
              <stop offset="100%" stopColor={def.color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="i" hide />
          <YAxis hide />
          <Tooltip contentStyle={{ background: "#1e2636", border: "1px solid #2b3650", borderRadius: 8, fontSize: 12 }} />
          <Area
            type="monotone"
            dataKey="value"
            stroke={def.color}
            fill={`url(#g-${metric})`}
            strokeWidth={2}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
      </div>
    </div>
  );
};

/** A control button whose icon stays constant — the command's round-trip shows as motion /
 *  colour, never an icon swap: pulse while in-flight, a green ring on success, red on failure.
 *  `confirm` arms on first tap (red, pulsing) and fires on the second; `disabled` for the lock. */
export const ActionButton = (props: {
  readonly atom: CommandAtom;
  readonly label: string;
  readonly icon?: React.ReactNode;
  readonly destructive?: boolean;
  readonly disabled?: boolean;
  readonly confirm?: boolean;
}): React.ReactElement => {
  const trigger = useAtomSet(props.atom);
  const r = useAtomValue(props.atom);
  const pending = AsyncResult.isWaiting(r);
  const failed = AsyncResult.isFailure(r) && !pending;
  const [flash, setFlash] = React.useState(false);
  const [armed, setArmed] = React.useState(false);
  const wasPending = React.useRef(false);
  React.useEffect(() => {
    if (pending) {
      wasPending.current = true;
      return;
    }
    if (wasPending.current && AsyncResult.isSuccess(r)) {
      wasPending.current = false;
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 1200);
      return () => clearTimeout(t);
    }
    return;
  }, [pending, r]);
  // confirm: first tap arms (auto-disarms after 3s), second tap fires
  React.useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  const fire = (): void => {
    if (props.confirm === true && !armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    trigger();
  };
  const disabled = pending || props.disabled === true;
  const danger = armed || failed || props.destructive === true;
  const feedback = pending
    ? "animate-pulse"
    : armed
      ? "ring-2 ring-destructive ring-offset-1 animate-pulse"
      : flash
        ? "ring-2 ring-emerald-500 ring-offset-1 transition-shadow"
        : "transition-shadow";

  if (props.icon !== undefined) {
    return (
      <Button
        variant={danger ? "destructive" : "outline"}
        size="icon"
        disabled={disabled}
        onClick={fire}
        title={armed ? `tap again to confirm: ${props.label}` : props.label}
        aria-label={armed ? `confirm ${props.label}` : props.label}
        className={feedback}
      >
        {props.icon}
      </Button>
    );
  }
  const suffix = pending ? " …" : flash ? " ✓" : failed ? " ✗" : armed ? " — confirm?" : "";
  return (
    <Button
      variant={danger ? "destructive" : "outline"}
      size="sm"
      disabled={disabled}
      onClick={fire}
      className={feedback}
    >
      {props.label}
      {suffix}
    </Button>
  );
};

/** Lock toggle for a control row — guards against accidental taps. Locking is immediate;
 *  unlocking takes a confirm tap (red + pulse) so the guard isn't fat-fingered off. */
const LockToggle = (props: { readonly locked: boolean; readonly onToggle: () => void }): React.ReactElement => {
  const [armed, setArmed] = React.useState(false);
  React.useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  const onClick = (): void => {
    if (!props.locked) {
      props.onToggle(); // lock immediately
      return;
    }
    if (!armed) {
      setArmed(true); // first tap arms the unlock
      return;
    }
    setArmed(false);
    props.onToggle(); // second tap unlocks
  };
  return (
    <Button
      type="button"
      variant={armed ? "destructive" : props.locked ? "secondary" : "outline"}
      size="icon"
      onClick={onClick}
      title={props.locked ? (armed ? "tap again to unlock" : "unlock controls") : "lock controls"}
      aria-label={props.locked ? "unlock controls" : "lock controls"}
      className={armed ? "ring-2 ring-destructive ring-offset-1 animate-pulse" : "transition-shadow"}
    >
      {props.locked ? <Lock className="size-4" /> : <LockOpen className="size-4" />}
    </Button>
  );
};

/** Prototype controls: icon buttons, with pause/resume folded into one toggle that reflects
 *  the live `paused` state. */
export const QueueControls = (props: { readonly bundle: QueueBundle }): React.ReactElement => {
  const statusR = useAtomValue(props.bundle.status);
  const s = AsyncResult.isSuccess(statusR) ? statusR.value : undefined;
  const paused = s?.paused === true;
  const [locked, setLocked] = React.useState(true);
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
      {paused ? (
        <ActionButton atom={props.bundle.resume} label="resume" icon={<Play className="size-4" />} disabled={locked} />
      ) : (
        <ActionButton atom={props.bundle.pause} label="pause" icon={<Pause className="size-4" />} disabled={locked} />
      )}
      <ActionButton atom={props.bundle.clear} label="clear" icon={<Trash2 className="size-4" />} disabled={locked} confirm />
      <ActionButton atom={props.bundle.shutdown} label="shutdown" icon={<Power className="size-4" />} disabled={locked} confirm destructive />
      <LockToggle locked={locked} onToggle={() => setLocked((l) => !l)} />
    </div>
  );
};

/** The live log stream (auto-scrolls to newest). Works for any bundle with `logs`. */
export const LogStream = (props: {
  readonly bundle: { readonly logs: QueueBundle["logs"] };
  readonly className?: string;
}): React.ReactElement => {
  const r = useAtomValue(props.bundle.logs);
  React.useEffect(() => dlog("logs", asyncTag(r)), [r]);
  const logs: ReadonlyArray<LogLine> = AsyncResult.isSuccess(r) ? r.value : [];
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (el !== null) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logs.length]);
  return (
    <div ref={ref} className={cn("overflow-auto text-xs", props.className)}>
      {logs.map((l) => (
        <div key={l.id} className="flex gap-2 px-2 py-0.5">
          <span className="w-20 shrink-0 text-muted-foreground">{new Date(l.t).toLocaleTimeString()}</span>
          <span className="w-14 shrink-0" style={{ color: LEVEL[l.level] ?? "#cbd5e1" }}>{l.level}</span>
          <span className="break-all">{l.message}</span>
        </div>
      ))}
    </div>
  );
};

// ── process widgets ──────────────────────────────────────────────────────────

/** A process as a grid card — supervision state + active instances. */
export const ProcessCard = (props: {
  readonly tag: ProcessTag;
  readonly onOpen: (t: ProcessTag) => void;
}): React.ReactElement => {
  const vt = useViewTransitionStyle(`res-${props.tag.id}`);
  const r = useAtomValue(processBundle(props.tag).status);
  const s = AsyncResult.isSuccess(r) ? r.value : undefined;
  return (
    <button
      type="button"
      onClick={() => props.onOpen(props.tag)}
      style={vt}
      className="rounded-xl border bg-card p-3 text-left transition-colors hover:border-ring"
    >
      <div className="mb-2 flex items-center gap-2">
        <span>⚙</span>
        <strong className="flex-1 truncate">{displayName(props.tag.id)}</strong>
        {hostOf(props.tag.id) !== undefined ? <Badge color="#06b6d4">⬡ {hostOf(props.tag.id)}</Badge> : null}
        <Badge color={s?.supervising === true ? "#22c55e" : "#94a3b8"}>
          {s?.supervising === true ? "running" : "stopped"}
        </Badge>
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{s?.armed === true ? "armed" : "disarmed"}</span>
        <span><strong className="text-foreground">{s?.activeInstances ?? 0}</strong> active</span>
      </div>
    </button>
  );
};

/** Stat cards from a process's live status. */
export const ProcessStats = (props: { readonly bundle: ProcessBundle }): React.ReactElement => {
  const r = useAtomValue(props.bundle.status);
  const s = AsyncResult.isSuccess(r) ? r.value : undefined;
  return (
    <div className="flex flex-wrap gap-2">
      <Stat label="supervising" value={s?.supervising === true ? "yes" : "no"} />
      <Stat label="armed" value={s?.armed === true ? "yes" : "no"} />
      <Stat label="active" value={String(s?.activeInstances ?? 0)} />
    </div>
  );
};

/** Process controls — start / stop / run-now (with round-trip feedback). */
/** Prototype controls: icon buttons, start/stop folded into one toggle on the live
 *  `supervising` state. */
export const ProcessControls = (props: { readonly bundle: ProcessBundle }): React.ReactElement => {
  const statusR = useAtomValue(props.bundle.status);
  const s = AsyncResult.isSuccess(statusR) ? statusR.value : undefined;
  const up = s?.supervising === true;
  const [locked, setLocked] = React.useState(true);
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
      {up ? (
        <ActionButton atom={props.bundle.stop} label="stop" icon={<Square className="size-4" />} disabled={locked} confirm destructive />
      ) : (
        <ActionButton atom={props.bundle.start} label="start" icon={<Play className="size-4" />} disabled={locked} />
      )}
      <ActionButton atom={props.bundle.runImmediately} label="run now" icon={<RotateCw className="size-4" />} disabled={locked} />
      <LockToggle locked={locked} onToggle={() => setLocked((l) => !l)} />
    </div>
  );
};

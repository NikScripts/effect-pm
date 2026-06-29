/**
 * @module web/widgets
 *
 * Hand-crafted, per-type dashboard widgets — the building blocks the `<Dashboard>` and its
 * mobile/desktop views compose. Each is driven by a **tag** (its bundle comes from
 * `useQueueBundle` / `useProcessBundle` over the context runtime); the tree is a `Group.Tag`
 * walked with `Group.members` / `Group.isGroup`.
 *
 * @since 1.0.0
 */
import * as React from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { Cause, DateTime } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { Lock, LockOpen, Maximize2, Pause, Play, Power, RotateCw, Square, Trash2 } from "lucide-react";
import * as Group from "../Group";
import {
  type ApiBundle,
  type ApiPoint,
  type ApiTag,
  type CommandAtom,
  type GroupNode,
  type LogLine,
  type MetricPoint,
  type ProcessBundle,
  type ProcessTag,
  type QueueBundle,
  type QueueTag,
  type ScheduleEntry,
  type HostRef,
  hostsOf,
  kindOf,
  leafTags,
  queueLeaves,
} from "./data";
import type { ApiUsageMetrics } from "../ApiUsageSchema";
import type { Status as HostStatusValue } from "../HostStatus";
import { useApiBundle, useHostBundle, useProcessBundle, useQueueBundle } from "./runtime";
import { useAtomSet, useAtomValue } from "../ui/atom-react";
import { useViewTransitionStyle } from "./useViewTransition";
import { dlog } from "./debug-console";
import { dateFromMillis, fmtClock, fmtDayLabel, millisFromLocalInput, now, startOfDayMillis, toLocalInput } from "./now";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent } from "./components/ui/card";
import { cn } from "./cn";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";

/** Last path segment of a tag/group id. @since 1.0.0 */
export const displayName = (key: string): string => key.split("/").pop() ?? key;
/** Format milliseconds as seconds. @since 1.0.0 */
export const fmtMs = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

/** A short label for an AsyncResult, for debug logging. */
const asyncTag = (r: AsyncResult.AsyncResult<unknown, unknown>): string =>
  AsyncResult.isSuccess(r)
    ? `Success${Array.isArray(r.value) ? `(${r.value.length})` : ""}`
    : AsyncResult.isFailure(r)
      ? "Failure"
      : AsyncResult.isWaiting(r)
        ? "Waiting"
        : "Initial";

/** Phase → label + colour. @since 1.0.0 */
export const STATUS: Record<string, { label: string; color: string }> = {
  running: { label: "running", color: "#22c55e" },
  paused: { label: "paused", color: "#eab308" },
  draining: { label: "draining", color: "#06b6d4" },
  off: { label: "off", color: "#ef4444" },
};
/** Resolve the status key from phase + paused. @since 1.0.0 */
export const statusKey = (phase: string, paused: boolean): string =>
  phase === "off" ? "off" : phase === "draining" ? "draining" : paused ? "paused" : "running";

const PRIO = { high: "#ef4444", normal: "#94a3b8", low: "#3b82f6" } as const;
const LEVEL: Record<string, string> = {
  Info: "#cbd5e1",
  Warning: "#eab308",
  Error: "#ef4444",
  Fatal: "#ef4444",
};

/** A coloured status pill. @since 1.0.0 */
export const StatusBadge = (props: { readonly phase: string; readonly paused: boolean }): React.ReactElement => {
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

/** A queue as a grid card. Reads its own status straight from the tag. @since 1.0.0 */
export const QueueCard = (props: {
  readonly tag: QueueTag;
  /** Display name — the member key under which the parent group holds this tag. */
  readonly name: string;
  readonly selected?: boolean;
  readonly onOpen: (tag: QueueTag) => void;
}): React.ReactElement => {
  const vt = useViewTransitionStyle(`res-${props.tag.key}`);
  const r = useAtomValue(useQueueBundle(props.tag).status);
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
        // flex-col so the content stays top-aligned when the grid stretches the card to the row
        // height — a bare <button> vertically centres its content in the slack.
        "flex flex-col rounded-xl border bg-card p-3 text-left transition-colors hover:border-ring",
        props.selected === true && "border-primary",
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <strong className="flex-1 truncate">{props.name}</strong>
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

const MemberRow = (props: { readonly tag: QueueTag; readonly name: string }): React.ReactElement => {
  const r = useAtomValue(useQueueBundle(props.tag).status);
  const s = AsyncResult.isSuccess(r) ? r.value : undefined;
  const sk = statusKey(s?.phase ?? "running", s?.paused ?? false);
  const pending = s === undefined ? 0 : s.sizes.high + s.sizes.normal + s.sizes.low;
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="size-2 shrink-0 rounded-full" style={{ background: STATUS[sk]?.color }} />
      <span className="flex-1 truncate">{props.name}</span>
      <span className="text-foreground">{pending}</span>
    </div>
  );
};

/** A subgroup as a grid widget — tap opens it as its own page (drill-down). @since 1.0.0 */
export const GroupCard = (props: {
  readonly node: GroupNode;
  /** Display name — the member key under which the parent group holds this subgroup. */
  readonly name: string;
  readonly onOpen: (g: GroupNode) => void;
}): React.ReactElement => {
  const vt = useViewTransitionStyle(`grp-${props.node.key}`);
  const members = Object.values(Group.members(props.node));
  const leaves = queueLeaves(props.node).slice(0, 4);
  const subs = members.filter((m): m is GroupNode => Group.isGroup(m));
  // The display name of a member is the key it sits under in this node — map member identity → key.
  const nameOf = new Map<unknown, string>(Object.entries(Group.members(props.node)).map(([k, m]) => [m, k]));
  return (
    <button
      type="button"
      onClick={() => props.onOpen(props.node)}
      style={vt}
      className="flex flex-col rounded-xl border border-[#06b6d455] bg-card p-3 text-left transition-colors hover:border-ring"
    >
      <div className="mb-2 flex items-center gap-2">
        <strong className="flex-1 truncate text-[#06b6d4]">▸ {props.name}</strong>
        <span className="text-xs text-muted-foreground">{leafTags(props.node).length} resources</span>
      </div>
      <div className="flex flex-col gap-1">
        {leaves.map((tag) => <MemberRow key={tag.key} tag={tag} name={nameOf.get(tag) ?? displayName(tag.key)} />)}
        {subs.map((sg) => (
          <div key={sg.key} className="text-xs text-[#06b6d4]">▸ {nameOf.get(sg) ?? displayName(sg.key)}</div>
        ))}
      </div>
      <div className="mt-auto pt-2 text-xs text-muted-foreground">tap to open →</div>
    </button>
  );
};

/** Dispatch a group member to its card (group / queue / process / api). @since 1.0.0 */
export const Cell = (props: {
  readonly member: unknown;
  /** Display name — the member key under which the current group holds this member. */
  readonly name: string;
  readonly onOpenLeaf: (tag: QueueTag | ProcessTag | ApiTag) => void;
  readonly onOpenGroup: (g: GroupNode) => void;
}): React.ReactElement => {
  if (Group.isGroup(props.member)) {
    return <GroupCard node={props.member as GroupNode} name={props.name} onOpen={props.onOpenGroup} />;
  }
  const kind = kindOf(props.member);
  if (kind === "api") {
    return <ApiCard tag={props.member as ApiTag} name={props.name} onOpen={props.onOpenLeaf} />;
  }
  return kind === "process" ? (
    <ProcessCard tag={props.member as ProcessTag} name={props.name} onOpen={props.onOpenLeaf} />
  ) : (
    <QueueCard tag={props.member as QueueTag} name={props.name} onOpen={props.onOpenLeaf} />
  );
};

/** A labelled stat card. @since 1.0.0 */
export const Stat = (props: { readonly label: string; readonly value: string }): React.ReactElement => (
  <Card className="flex-1">
    <CardContent className="p-3">
      <div className="text-xs text-muted-foreground">{props.label}</div>
      <div className="text-lg text-foreground">{props.value}</div>
    </CardContent>
  </Card>
);

/** Stat cards from the live status + metrics. @since 1.0.0 */
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

// Time windows the chart can show — each filters the deep metrics history by the point's real
// (server) timestamp, so the curve's span actually changes (backed by the host's history store).
// Only the windows the data actually reaches are offered (see `availableWindows`).
const ALL_MS = Number.POSITIVE_INFINITY;
const WINDOWS = [
  { label: "1m", ms: 60_000 },
  { label: "15m", ms: 900_000 },
  { label: "1h", ms: 3_600_000 },
  { label: "6h", ms: 21_600_000 },
  { label: "1d", ms: 86_400_000 },
  { label: "1w", ms: 604_800_000 },
  { label: "30d", ms: 2_592_000_000 },
  { label: "1y", ms: 31_536_000_000 },
  { label: "all", ms: ALL_MS },
] as const;
type Window = (typeof WINDOWS)[number];

/** The windows worth offering for a history that spans `spanMs`: every finite window the data
 *  fully covers, plus `all` once there's any data — and always at least the smallest, so there's
 *  a valid choice. "Only show what's available." */
const availableWindows = (spanMs: number, hasData: boolean): ReadonlyArray<Window> => {
  const finite = WINDOWS.filter((w) => w.ms !== ALL_MS && spanMs >= w.ms);
  const all = WINDOWS.filter((w) => w.ms === ALL_MS && hasData);
  const list = [...finite, ...all];
  return list.length > 0 ? list : [WINDOWS[0]];
};

/** A metric chart with a dropdown to pick the series (throughput/latency/pending), plus — for the
 *  history-backed series — a compact toggle that cycles the time window (1m→15m→1h). @since 1.0.0 */
export const MetricChart = (props: { readonly bundle: QueueBundle }): React.ReactElement => {
  const [metric, setMetric] = React.useState<MetricKey>("throughput");
  // Selection is kept by duration (not index) so it survives as more windows unlock with data.
  const [windowMs, setWindowMs] = React.useState<number>(WINDOWS[0].ms);
  const historyR = useAtomValue(props.bundle.history);
  const trendR = useAtomValue(props.bundle.trend);
  React.useEffect(() => dlog("history", asyncTag(historyR), "· trend", asyncTag(trendR)), [historyR, trendR]);
  const history: ReadonlyArray<MetricPoint> = AsyncResult.isSuccess(historyR) ? historyR.value : [];
  const trend: ReadonlyArray<number> = AsyncResult.isSuccess(trendR) ? trendR.value : [];
  const def = METRICS[metric];
  const oldest = history[0];
  const span = oldest === undefined ? 0 : now() - oldest.t;
  const windows = availableWindows(span, history.length > 0);
  // clamp the selection to what's currently available (fall back to the largest available)
  const win = windows.find((w) => w.ms === windowMs) ?? windows[windows.length - 1] ?? WINDOWS[0];
  const cutoff = win.ms === ALL_MS ? Number.NEGATIVE_INFINITY : now() - win.ms;
  const data =
    def.source === "trend"
      ? trend.map((v, i) => ({ i, value: v }))
      : history
          .filter((p) => p.t >= cutoff)
          .map((p, i) => ({ i, value: metric === "latency" ? p.latency / 1000 : p.throughput }));
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <select
          value={metric}
          onChange={(e) => setMetric(e.target.value as MetricKey)}
          className="rounded-md border bg-card px-2 py-1 text-sm font-semibold text-foreground"
        >
          {(Object.keys(METRICS) as Array<MetricKey>).map((k) => (
            <option key={k} value={k}>
              {METRICS[k].label}
            </option>
          ))}
        </select>
        {def.source === "history" ? (
          // Compact time-window control: tap to cycle through the windows the data reaches.
          // Cheaper on width than a second dropdown, which matters on a phone.
          <button
            type="button"
            onClick={() => {
              const idx = windows.findIndex((w) => w.ms === win.ms);
              const next = windows[(idx + 1) % windows.length];
              if (next !== undefined) setWindowMs(next.ms);
            }}
            className="rounded-md border bg-card px-2 py-1 text-sm font-semibold text-foreground transition-colors hover:border-ring"
            aria-label={`time window: ${win.label} (tap to change)`}
            title="tap to change time window"
          >
            {win.label}
          </button>
        ) : null}
      </div>
      {/* fixed-height wrapper + height="100%": a percentage-sized ResponsiveContainer in a
          content-sized flex parent grows on every measure tick — pinning the height breaks it.
          -mx-3 -mb-3 bleeds the chart to the card edges (the card supplies the padding). */}
      <div className="-mx-3 -mb-3 h-[140px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
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

/** A modal confirmation dialog — for destructive / guarded actions. @since 1.0.0 */
export const ConfirmDialog = (props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly destructive?: boolean;
  readonly onConfirm: () => void;
}): React.ReactElement => (
  <Dialog open={props.open} onOpenChange={props.onOpenChange}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{props.title}</DialogTitle>
        <DialogDescription>{props.description}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline" size="sm">Cancel</Button>
        </DialogClose>
        <Button
          variant={props.destructive === true ? "destructive" : "default"}
          size="sm"
          onClick={() => {
            props.onConfirm();
            props.onOpenChange(false);
          }}
        >
          {props.confirmLabel}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

/** A control button whose icon stays constant — the command's round-trip shows as motion /
 *  colour, never an icon swap: pulse while in-flight, a green ring on success, red on failure.
 *  `confirm` opens a modal dialog before firing; `disabled` for the lock. @since 1.0.0 */
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
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const wasPending = React.useRef(false);
  React.useEffect(() => {
    if (pending) {
      wasPending.current = true;
      return;
    }
    if (wasPending.current && AsyncResult.isSuccess(r)) {
      wasPending.current = false;
      setFlash(true);
      // @effect-diagnostics-next-line globalTimers:off
      const t = setTimeout(() => setFlash(false), 1200);
      return () => clearTimeout(t);
    }
    return;
  }, [pending, r]);
  const fire = (): void => {
    if (props.confirm === true) {
      setConfirmOpen(true);
      return;
    }
    trigger();
  };
  const disabled = pending || props.disabled === true;
  const danger = failed || props.destructive === true;
  const feedback = pending
    ? "animate-pulse"
    : flash
      ? "ring-2 ring-emerald-500 ring-offset-1 transition-shadow"
      : "transition-shadow";

  const dialog =
    props.confirm === true ? (
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`${props.label.charAt(0).toUpperCase()}${props.label.slice(1)}?`}
        description={`Are you sure you want to ${props.label} this resource?`}
        confirmLabel={props.label}
        destructive={props.destructive}
        onConfirm={trigger}
      />
    ) : null;

  if (props.icon !== undefined) {
    return (
      <>
        <Button
          variant={danger ? "destructive" : "outline"}
          size="icon"
          disabled={disabled}
          onClick={(e) => {
            e.currentTarget.blur();
            fire();
          }}
          title={props.label}
          aria-label={props.label}
          className={feedback}
        >
          {props.icon}
        </Button>
        {dialog}
      </>
    );
  }
  const suffix = pending ? " …" : flash ? " ✓" : failed ? " ✗" : "";
  return (
    <>
      <Button variant={danger ? "destructive" : "outline"} size="sm" disabled={disabled} onClick={fire} className={feedback}>
        {props.label}
        {suffix}
      </Button>
      {dialog}
    </>
  );
};

/** Lock toggle for a control row — guards against accidental taps. Locking is immediate;
 *  unlocking opens a confirm dialog so the guard isn't fat-fingered off. @since 1.0.0 */
export const LockToggle = (props: { readonly locked: boolean; readonly onToggle: () => void }): React.ReactElement => {
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const onClick = (): void => {
    if (props.locked) {
      setConfirmOpen(true);
      return;
    }
    props.onToggle();
  };
  return (
    <>
      <Button
        type="button"
        variant={props.locked ? "secondary" : "outline"}
        size="icon"
        onClick={onClick}
        title={props.locked ? "unlock controls" : "lock controls"}
        aria-label={props.locked ? "unlock controls" : "lock controls"}
        className="transition-shadow"
      >
        {props.locked ? <Lock className="size-4" /> : <LockOpen className="size-4" />}
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Unlock controls?"
        description="This enables the actuating controls (pause, clear, shutdown). Re-lock when you're done."
        confirmLabel="Unlock"
        onConfirm={props.onToggle}
      />
    </>
  );
};

/** Queue controls: icon buttons, pause/resume folded into one toggle on the live `paused`
 *  state, a lock (locked by default), and confirm on the destructive actions. @since 1.0.0 */
export const QueueControls = (props: { readonly bundle: QueueBundle }): React.ReactElement => {
  const statusR = useAtomValue(props.bundle.status);
  const s = AsyncResult.isSuccess(statusR) ? statusR.value : undefined;
  const paused = s?.paused === true;
  const [locked, setLocked] = React.useState(true);
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 sm:flex-col sm:flex-nowrap sm:items-center sm:justify-center">
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

/** The live log stream (auto-scrolls to newest). Works for any bundle with `logs`. @since 1.0.0 */
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
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [logs.length]);
  return (
    <div ref={ref} className={cn("overflow-auto text-xs", props.className)}>
      {logs.map((l) => (
        <div key={l.id} className="flex gap-2 px-2 py-0.5">
          <span className="w-16 shrink-0 whitespace-nowrap tabular-nums text-muted-foreground">{fmtClock(l.t)}</span>
          <span className="w-11 shrink-0 truncate" style={{ color: LEVEL[l.level] ?? "#cbd5e1" }}>{l.level}</span>
          <span className="break-all">{l.message}</span>
        </div>
      ))}
    </div>
  );
};

// ── process widgets ──────────────────────────────────────────────────────────

/** A process as a grid card — supervision state + active instances. @since 1.0.0 */
export const ProcessCard = (props: {
  readonly tag: ProcessTag;
  /** Display name — the member key under which the parent group holds this tag. */
  readonly name: string;
  readonly onOpen: (t: ProcessTag) => void;
}): React.ReactElement => {
  const vt = useViewTransitionStyle(`res-${props.tag.key}`);
  const r = useAtomValue(useProcessBundle(props.tag).status);
  const s = AsyncResult.isSuccess(r) ? r.value : undefined;
  return (
    <button
      type="button"
      onClick={() => props.onOpen(props.tag)}
      style={vt}
      className="flex flex-col rounded-xl border bg-card p-3 text-left transition-colors hover:border-ring"
    >
      <div className="mb-2 flex items-center gap-2">
        <span>⚙</span>
        <strong className="flex-1 truncate">{props.name}</strong>
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

/** Stat cards from a process's live status. @since 1.0.0 */
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

/** Process controls: icon buttons, start/stop folded into one toggle on the live `supervising`
 *  state, a lock, and confirm on stop. The lock is hoisted (one lock guards both these controls
 *  and the {@link ScheduleEditor}), so the caller owns `locked` / `onToggleLock`. @since 1.0.0 */
export const ProcessControls = (props: {
  readonly bundle: ProcessBundle;
  readonly locked: boolean;
  readonly onToggleLock: () => void;
}): React.ReactElement => {
  const statusR = useAtomValue(props.bundle.status);
  const s = AsyncResult.isSuccess(statusR) ? statusR.value : undefined;
  const up = s?.supervising === true;
  const locked = props.locked;
  // A process has no chart to sit beside, so its controls stay a horizontal row at every width
  // (only the queue controls go vertical, to flank the graph).
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {up ? (
        <ActionButton atom={props.bundle.stop} label="stop" icon={<Square className="size-4" />} disabled={locked} confirm destructive />
      ) : (
        <ActionButton atom={props.bundle.start} label="start" icon={<Play className="size-4" />} disabled={locked} />
      )}
      <ActionButton atom={props.bundle.runImmediately} label="run now" icon={<RotateCw className="size-4" />} disabled={locked} />
      <LockToggle locked={locked} onToggle={props.onToggleLock} />
    </div>
  );
};

// ── schedule editing ──────────────────────────────────────────────────────────

/** A schedule entry's `DateTime.Utc` → a compact human label. */
const fmtWhen = (e: DateTime.Utc): string =>
  dateFromMillis(DateTime.toEpochMillis(e)).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

/** A read-only row in the inline schedule summary — one run window. Editing/removal lives on the
 *  fullscreen week view. */
const ScheduleRow = (props: { readonly entry: ScheduleEntry }): React.ReactElement => (
  <li className="flex items-center gap-2 text-sm">
    <span className="tabular-nums">{fmtWhen(props.entry.startAt)}</span>
    <span className="text-muted-foreground">
      → {props.entry.stopAt === undefined ? "open-ended" : fmtWhen(props.entry.stopAt)}
    </span>
    {props.entry.id !== undefined ? <span className="ml-auto text-xs text-muted-foreground">{props.entry.id}</span> : null}
  </li>
);

/** The popup to add **or edit** one run window — start (required) + optional stop. When `initial`
 *  is given it's an edit (fields pre-filled, `onDelete` shown); otherwise it adds. @since 1.0.0 */
export const WindowDialog = (props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly initial?: ScheduleEntry;
  readonly onSubmit: (entry: ScheduleEntry) => void;
  readonly onDelete?: () => void;
}): React.ReactElement => {
  const [start, setStart] = React.useState("");
  const [stop, setStop] = React.useState("");
  // Seed the fields once per open (the false→true edge), NOT on every `initial` change — the
  // schedule polls, so re-seeding on `initial` would clobber the user's edits mid-typing.
  const wasOpen = React.useRef(false);
  React.useEffect(() => {
    if (props.open && !wasOpen.current) {
      setStart(props.initial === undefined ? "" : toLocalInput(DateTime.toEpochMillis(props.initial.startAt)));
      setStop(props.initial?.stopAt === undefined ? "" : toLocalInput(DateTime.toEpochMillis(props.initial.stopAt)));
    }
    wasOpen.current = props.open;
  }, [props.open, props.initial]);
  const editing = props.initial !== undefined;
  const startMs = millisFromLocalInput(start);
  const submit = (): void => {
    if (startMs === undefined) return;
    const stopMs = millisFromLocalInput(stop);
    props.onSubmit({
      ...(props.initial?.id !== undefined ? { id: props.initial.id } : {}),
      startAt: DateTime.makeUnsafe(startMs),
      ...(stopMs !== undefined ? { stopAt: DateTime.makeUnsafe(stopMs) } : {}),
    });
    props.onOpenChange(false);
  };
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {/* Don't autofocus the first field — on iOS focusing a datetime-local pops the picker. */}
      <DialogContent onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit run window" : "Add run window"}</DialogTitle>
          <DialogDescription>The process is armed while now is inside a window.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-1">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            start
            <input
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="rounded-md border bg-background px-2 py-1 text-sm text-foreground"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            stop (optional — blank = open-ended)
            <input
              type="datetime-local"
              value={stop}
              onChange={(e) => setStop(e.target.value)}
              className="rounded-md border bg-background px-2 py-1 text-sm text-foreground"
            />
          </label>
        </div>
        <DialogFooter>
          {editing && props.onDelete !== undefined ? (
            <Button
              variant="destructive"
              size="sm"
              className="mr-auto"
              onClick={() => {
                props.onDelete?.();
                props.onOpenChange(false);
              }}
            >
              <Trash2 className="size-4" /> Delete
            </Button>
          ) : null}
          <DialogClose asChild>
            <Button variant="outline" size="sm">Cancel</Button>
          </DialogClose>
          <Button size="sm" onClick={submit} disabled={startMs === undefined}>
            {editing ? "Save" : "Add window"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/** View + edit a process's schedule (the run windows that arm it). Reads the current entries, then
 *  `setSchedule`/`clearSchedule` to mutate — gated by the **shared** process lock (`locked`), so
 *  one lock guards both the controls and the schedule. Edits apply optimistically (the schedule is
 *  read once on open); adding a window is a popup. @since 1.0.0 */
/** The shared edit state for a process schedule — the current entries plus add/remove/clear, applied
 *  optimistically (the schedule reads once on open). Used by both the inline {@link ScheduleEditor}
 *  and the fullscreen week view. @since 1.0.0 */
export const useScheduleEdit = (
  bundle: ProcessBundle,
): {
  readonly list: ReadonlyArray<ScheduleEntry>;
  readonly addEntry: (entry: ScheduleEntry) => void;
  readonly update: (index: number, entry: ScheduleEntry) => void;
  readonly remove: (index: number) => void;
  readonly clearAll: () => void;
} => {
  const loadedR = useAtomValue(bundle.schedule);
  const loaded = AsyncResult.isSuccess(loadedR) ? loadedR.value : undefined;
  const setSchedule = useAtomSet(bundle.setSchedule);
  const clearSchedule = useAtomSet(bundle.clearSchedule);
  const [edited, setEdited] = React.useState<ReadonlyArray<ScheduleEntry> | undefined>(undefined);
  const list = edited ?? loaded ?? [];
  const apply = (next: ReadonlyArray<ScheduleEntry>): void => {
    setEdited(next);
    setSchedule(next);
  };
  const byStart = (a: ScheduleEntry, b: ScheduleEntry): number =>
    DateTime.toEpochMillis(a.startAt) - DateTime.toEpochMillis(b.startAt);
  return {
    list,
    addEntry: (entry) => apply([...list, entry].sort(byStart)),
    update: (i, entry) => apply(list.map((e, j) => (j === i ? entry : e)).sort(byStart)),
    remove: (i) => apply(list.filter((_, j) => j !== i)),
    clearAll: () => {
      setEdited([]);
      clearSchedule();
    },
  };
};

const HOUR_PX = 28;
const DAY_PX = 24 * HOUR_PX;
const DAY_MS = 86_400_000;

/** A weekly calendar grid of the run windows — 7 day columns × 24 hours, each window drawn as a
 *  block at its real position, with a "now" line. Multi-day windows are clipped per day; open-ended
 *  windows fill to the end of each day from their start. @since 1.0.0 */
export const WeekSchedule = (props: {
  readonly entries: ReadonlyArray<ScheduleEntry>;
  readonly weekStart: number;
  /** When provided (and unlocked), tapping a window's block selects it (to edit) by entry index. */
  readonly onSelectEntry?: (index: number) => void;
}): React.ReactElement => {
  const clickable = props.onSelectEntry;
  const nowMs = now();
  const todayStart = startOfDayMillis(nowMs);
  const days = Array.from({ length: 7 }, (_, i) => props.weekStart + i * DAY_MS);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card">
      <div className="flex border-b text-xs text-muted-foreground">
        <div className="w-10 shrink-0" />
        {days.map((d) => (
          <div key={d} className={cn("flex-1 p-1 text-center", d === todayStart && "font-semibold text-foreground")}>
            {fmtDayLabel(d)}
          </div>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 overflow-y-auto">
        <div className="w-10 shrink-0">
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} style={{ height: HOUR_PX }} className="pr-1 text-right text-[10px] text-muted-foreground">
              {String(h).padStart(2, "0")}
            </div>
          ))}
        </div>
        {days.map((dayStart) => {
          const dayEnd = dayStart + DAY_MS;
          return (
            <div key={dayStart} className="relative flex-1 border-l" style={{ height: DAY_PX }}>
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} style={{ top: h * HOUR_PX }} className="absolute inset-x-0 border-b border-border/40" />
              ))}
              {nowMs >= dayStart && nowMs < dayEnd ? (
                <div className="absolute inset-x-0 z-10 border-t-2 border-[#ef4444]" style={{ top: ((nowMs - dayStart) / DAY_MS) * DAY_PX }} />
              ) : null}
              {props.entries.flatMap((entry, idx) => {
                const s = DateTime.toEpochMillis(entry.startAt);
                const e = entry.stopAt === undefined ? Number.POSITIVE_INFINITY : DateTime.toEpochMillis(entry.stopAt);
                const from = Math.max(s, dayStart);
                const to = Math.min(e, dayEnd);
                if (to <= from) return [];
                const top = ((from - dayStart) / DAY_MS) * DAY_PX;
                const height = Math.max(((to - from) / DAY_MS) * DAY_PX, 4);
                const label = entry.id ?? fmtClock(s);
                const range = `${fmtWhen(entry.startAt)} → ${entry.stopAt === undefined ? "open-ended" : fmtWhen(entry.stopAt)}`;
                return [
                  <button
                    type="button"
                    key={`${idx}-${dayStart}`}
                    disabled={clickable === undefined}
                    onClick={clickable === undefined ? undefined : () => clickable(idx)}
                    style={{ top, height }}
                    className={cn(
                      "absolute inset-x-0.5 z-20 overflow-hidden rounded border border-primary bg-primary/30 px-1 text-left text-[10px] leading-tight text-foreground",
                      clickable !== undefined && "cursor-pointer hover:bg-primary/50",
                    )}
                    title={clickable === undefined ? `${label} · ${range}` : `${label} · ${range} — tap to edit`}
                  >
                    {label}
                  </button>,
                ];
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** A read-only summary of a process's schedule (the run windows that arm it) — the count, the list,
 *  and an expand button to the fullscreen week view, which is where editing (add / remove / clear)
 *  happens. @since 1.0.0 */
export const ScheduleEditor = (props: {
  readonly bundle: ProcessBundle;
  readonly onOpenFull?: () => void;
}): React.ReactElement => {
  const r = useAtomValue(props.bundle.schedule);
  const list = AsyncResult.isSuccess(r) ? r.value : [];
  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-card p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>SCHEDULE · {list.length} window{list.length === 1 ? "" : "s"}</span>
        {props.onOpenFull !== undefined ? (
          <button
            type="button"
            onClick={props.onOpenFull}
            className="ml-auto rounded p-1 hover:bg-accent"
            title="open week view to edit"
            aria-label="open fullscreen week view"
          >
            <Maximize2 className="size-4" />
          </button>
        ) : null}
      </div>

      {list.length === 0 ? (
        <div className="text-xs text-muted-foreground">No run windows — the process is disarmed.</div>
      ) : (
        <ul className="flex flex-col gap-1">
          {list.map((entry, i) => (
            <ScheduleRow key={`${DateTime.toEpochMillis(entry.startAt)}-${i}`} entry={entry} />
          ))}
        </ul>
      )}
    </div>
  );
};

// ── api widgets ───────────────────────────────────────────────────────────────

/** Error-rate → health label + colour (green / amber / red). Shared by the API card badge and
 *  {@link ApiStats}. @since 1.0.0 */
export const apiHealth = (requests: number, errors: number): { readonly label: string; readonly color: string } => {
  const rate = requests > 0 ? errors / requests : 0;
  if (rate >= 0.1) return { label: "errors", color: "#ef4444" };
  if (rate >= 0.02) return { label: "degraded", color: "#eab308" };
  return { label: "healthy", color: "#22c55e" };
};

/** A tiny inline sparkline (last ~40 values), no axes — for the API card's throughput face. */
const Sparkline = (props: { readonly points: ReadonlyArray<number>; readonly color: string }): React.ReactElement => {
  const pts = props.points.slice(-40);
  if (pts.length < 2) return <div className="h-10" />;
  const max = Math.max(...pts, 1);
  const min = Math.min(...pts, 0);
  const range = max - min || 1;
  const line = pts
    .map((v, i) => `${(i / (pts.length - 1)) * 100},${100 - ((v - min) / range) * 100}`)
    .join(" ");
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-10 w-full">
      <polyline points={line} fill="none" stroke={props.color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
};

/** A reusable iOS-home-screen-style **paged card**: horizontal scroll-snap track + dot indicators.
 *  Presentational. Tap fires `onOpen` (a swipe scrolls instead and the click is suppressed); the
 *  root is a `div role="button"` so a horizontal scroller can nest cleanly. @since 1.0.0 */
export const PagedCard = (props: {
  readonly pages: ReadonlyArray<React.ReactNode>;
  readonly onOpen?: () => void;
  readonly style?: React.CSSProperties;
}): React.ReactElement => {
  const ref = React.useRef<HTMLDivElement>(null);
  const [active, setActive] = React.useState(0);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={props.onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") props.onOpen?.();
      }}
      style={props.style}
      className="flex flex-col rounded-xl border bg-card p-3 text-left transition-colors hover:border-ring focus-visible:border-ring focus-visible:outline-none"
    >
      <div
        ref={ref}
        onScroll={() => {
          const el = ref.current;
          if (el !== null && el.clientWidth > 0) setActive(Math.round(el.scrollLeft / el.clientWidth));
        }}
        className="flex snap-x snap-mandatory overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {props.pages.map((page, i) => (
          <div key={i} className="w-full shrink-0 snap-center">{page}</div>
        ))}
      </div>
      {props.pages.length > 1 ? (
        <div className="mt-2 flex justify-center gap-1">
          {props.pages.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                const el = ref.current;
                if (el !== null) el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
              }}
              className={cn("size-1.5 rounded-full transition-colors", i === active ? "bg-foreground" : "bg-muted-foreground/40")}
              aria-label={`page ${i + 1}`}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
};

/** Top endpoints (busiest first) from the latest window, or the snapshot's `topEndpoints`. */
const topEndpoints = (
  bundle: { readonly requests: number; readonly errors: number; readonly endpoint: string }[],
  limit: number,
): ReadonlyArray<{ readonly endpoint: string; readonly requests: number; readonly errors: number }> =>
  [...bundle].sort((a, b) => b.requests - a.requests).slice(0, limit);

/** An API-metrics resource as a grid card — a {@link PagedCard}: page 1 is throughput + health,
 *  page 2 is the busiest endpoints. Read-only. @since 1.0.0 */
export const ApiCard = (props: {
  readonly tag: ApiTag;
  /** Display name — the member key under which the parent group holds this tag. */
  readonly name: string;
  readonly onOpen: (t: ApiTag) => void;
}): React.ReactElement => {
  const vt = useViewTransitionStyle(`res-${props.tag.key}`);
  const bundle = useApiBundle(props.tag);
  const statusR = useAtomValue(bundle.status);
  const metricsR = useAtomValue(bundle.metrics);
  const historyR = useAtomValue(bundle.history);
  const s = AsyncResult.isSuccess(statusR) ? statusR.value : undefined;
  const m = AsyncResult.isSuccess(metricsR) ? metricsR.value : undefined;
  const history = AsyncResult.isSuccess(historyR) ? historyR.value : [];
  const health = apiHealth(s?.requestsTotal ?? 0, s?.errorsTotal ?? 0);
  const endpoints = topEndpoints([...(m?.byEndpoint ?? [])], 6);
  const maxReq = Math.max(...endpoints.map((e) => e.requests), 1);

  const page1 = (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span>🌐</span>
        <strong className="flex-1 truncate">{props.name}</strong>
        <Badge color={health.color}>{health.label}</Badge>
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span><strong className="text-foreground">{(m?.throughputPerSec ?? 0).toFixed(1)}</strong> req/s</span>
        <span><strong className="text-foreground">{s?.inFlight ?? 0}</strong> in-flight</span>
      </div>
      <Sparkline points={history.map((p) => p.throughput)} color={health.color} />
    </div>
  );
  // No header on page 2 — drop it so we can fit more endpoint bars (page 1 already names the card).
  const page2 =
    endpoints.length === 0 ? (
      <div className="text-xs text-muted-foreground">No endpoint activity yet.</div>
    ) : (
      <div className="flex flex-col gap-1">
        {endpoints.map((e, i) => (
          <div key={`${e.endpoint}-${i}`} className="flex items-center gap-2">
            <span className="flex-1 truncate text-xs">{e.endpoint}</span>
            <div className="flex w-14 shrink-0">
              <Bar value={e.requests} max={maxReq} color="#3b82f6" />
            </div>
            <span className="w-7 text-right text-xs">{e.requests}</span>
          </div>
        ))}
      </div>
    );
  return <PagedCard onOpen={() => props.onOpen(props.tag)} style={vt} pages={[page1, page2]} />;
};

/** Stat cards from an API resource's snapshot + latest window. @since 1.0.0 */
export const ApiStats = (props: { readonly bundle: ApiBundle }): React.ReactElement => {
  const statusR = useAtomValue(props.bundle.status);
  const metricsR = useAtomValue(props.bundle.metrics);
  const s = AsyncResult.isSuccess(statusR) ? statusR.value : undefined;
  const m = AsyncResult.isSuccess(metricsR) ? metricsR.value : undefined;
  const requests = s?.requestsTotal ?? 0;
  const errors = s?.errorsTotal ?? 0;
  const rate = requests > 0 ? (errors / requests) * 100 : 0;
  return (
    <div className="flex flex-wrap gap-2">
      <Stat label="requests" value={String(requests)} />
      <Stat label="errors" value={String(errors)} />
      <Stat label="error rate" value={`${rate.toFixed(1)}%`} />
      <Stat label="in-flight" value={String(s?.inFlight ?? 0)} />
      <Stat label="req/s" value={(m?.throughputPerSec ?? 0).toFixed(1)} />
    </div>
  );
};

const API_SERIES = {
  throughput: { label: "throughput /s", color: "#22c55e", pick: (p: ApiPoint) => p.throughput },
  errors: { label: "errors", color: "#ef4444", pick: (p: ApiPoint) => p.errors },
  inFlight: { label: "in-flight", color: "#3b82f6", pick: (p: ApiPoint) => p.inFlight },
};
type ApiSeriesKey = keyof typeof API_SERIES;

/** An API usage chart — a dropdown switches throughput / errors / in-flight, fed from the
 *  accumulated metrics history. @since 1.0.0 */
export const ApiMetricChart = (props: { readonly bundle: ApiBundle }): React.ReactElement => {
  const [series, setSeries] = React.useState<ApiSeriesKey>("throughput");
  // Selection is kept by duration (not index) so it survives as more windows unlock with data.
  const [windowMs, setWindowMs] = React.useState<number>(WINDOWS[0].ms);
  const r = useAtomValue(props.bundle.history);
  const history: ReadonlyArray<ApiPoint> = AsyncResult.isSuccess(r) ? r.value : [];
  const def = API_SERIES[series];
  const oldest = history[0];
  const span = oldest === undefined ? 0 : now() - oldest.t;
  const windows = availableWindows(span, history.length > 0);
  const win = windows.find((w) => w.ms === windowMs) ?? windows[windows.length - 1] ?? WINDOWS[0];
  const cutoff = win.ms === ALL_MS ? Number.NEGATIVE_INFINITY : now() - win.ms;
  const data = history.filter((p) => p.t >= cutoff).map((p, i) => ({ i, value: def.pick(p) }));
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <select
          value={series}
          onChange={(e) => setSeries(e.target.value as ApiSeriesKey)}
          className="rounded-md border bg-card px-2 py-1 text-sm font-semibold text-foreground"
        >
          {(Object.keys(API_SERIES) as Array<ApiSeriesKey>).map((k) => (
            <option key={k} value={k}>{API_SERIES[k].label}</option>
          ))}
        </select>
        {/* Compact time-window control: tap to cycle through the windows the data reaches. */}
        <button
          type="button"
          onClick={() => {
            const idx = windows.findIndex((w) => w.ms === win.ms);
            const next = windows[(idx + 1) % windows.length];
            if (next !== undefined) setWindowMs(next.ms);
          }}
          className="rounded-md border bg-card px-2 py-1 text-sm font-semibold text-foreground transition-colors hover:border-ring"
          aria-label={`time window: ${win.label} (tap to change)`}
          title="tap to change time window"
        >
          {win.label}
        </button>
      </div>
      <div className="-mx-3 -mb-3 h-[140px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={`ga-${series}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={def.color} stopOpacity={0.5} />
                <stop offset="100%" stopColor={def.color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="i" hide />
            <YAxis hide />
            <Tooltip contentStyle={{ background: "#1e2636", border: "1px solid #2b3650", borderRadius: 8, fontSize: 12 }} />
            <Area type="monotone" dataKey="value" stroke={def.color} fill={`url(#ga-${series})`} strokeWidth={2} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

/** One per-endpoint row (the element of a metrics window's `byEndpoint`). */
type EndpointRow = ApiUsageMetrics["byEndpoint"][number];

const endpointColumns: Array<ColumnDef<EndpointRow>> = [
  {
    id: "group",
    header: "group",
    accessorKey: "group",
    cell: (c) => <span className="block truncate text-muted-foreground">{c.getValue<string>()}</span>,
  },
  {
    id: "endpoint",
    header: "endpoint",
    accessorKey: "endpoint",
    cell: (c) => <span className="block truncate">{c.getValue<string>()}</span>,
  },
  { id: "requests", header: "req", accessorKey: "requests" },
  { id: "errors", header: "err", accessorKey: "errors" },
  {
    id: "avg",
    header: "avg",
    accessorFn: (r) => r.avgDurationMs ?? 0,
    cell: (c) => (c.row.original.avgDurationMs !== undefined ? fmtMs(c.row.original.avgDurationMs) : "—"),
  },
];

/** The numeric (right-aligned) endpoint columns. */
const numericEndpointCols = new Set(["requests", "errors", "avg"]);

const SORT_GLYPH: Record<string, string> = { asc: " ▲", desc: " ▼" };

/** The per-endpoint table — `group · endpoint` with requests / errors / avg-ms, in a sortable
 *  TanStack table (tap a header to sort; default busiest-first). Error rows are tinted. The
 *  distinctive API widget. @since 1.0.0 */
export const ApiEndpointTable = (props: { readonly bundle: ApiBundle }): React.ReactElement => {
  const r = useAtomValue(props.bundle.metrics);
  const m = AsyncResult.isSuccess(r) ? r.value : undefined;
  const rows = React.useMemo(() => [...(m?.byEndpoint ?? [])], [m]);
  const [sorting, setSorting] = React.useState<SortingState>([{ id: "requests", desc: true }]);
  const table = useReactTable({
    data: rows,
    columns: endpointColumns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 rounded-xl border bg-card p-3">
      <div className="text-xs text-muted-foreground">ENDPOINTS · {rows.length}</div>
      {rows.length === 0 ? (
        <div className="text-xs text-muted-foreground">No endpoint activity yet.</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full table-fixed text-sm">
            <thead className="sticky top-0 bg-card">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id} className="text-xs text-muted-foreground">
                  {hg.headers.map((h) => (
                    <th
                      key={h.id}
                      onClick={h.column.getToggleSortingHandler()}
                      className={cn(
                        "cursor-pointer select-none py-1 font-normal hover:text-foreground",
                        numericEndpointCols.has(h.column.id) ? "text-right" : "text-left",
                        h.column.id === "group" ? "w-20" : "",
                        h.column.id === "requests" || h.column.id === "errors" ? "w-12" : "",
                        h.column.id === "avg" ? "w-16" : "",
                      )}
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {SORT_GLYPH[h.column.getIsSorted() as string] ?? ""}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id} className={row.original.errors > 0 ? "text-[#ef4444]" : ""}>
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className={cn(
                        "py-0.5",
                        numericEndpointCols.has(cell.column.id) ? "text-right tabular-nums" : "truncate",
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ── Host widgets ─────────────────────────────────────────────────────────────
// Hosts are read straight off the tags (`hostsOf`): a dot per host the group's resources are bound
// to. Each dot's colour + popover come from that host's `HostStatus` (over its own transport).

/** A host's overall colour: grey while connecting, red down, amber degraded, green ok. @since 1.0.0 */
const hostColor = (s: HostStatusValue | undefined): string =>
  s === undefined ? "#64748b" : !s.up ? "#ef4444" : s.status === "degraded" ? "#eab308" : "#22c55e";

/** Format an uptime span (ms) compactly. @since 1.0.0 */
const fmtUptime = (ms: number): string => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
};

/** One host indicator dot + tap-for-info popover (tap again, or "view host", for the full screen).
 *  @since 1.0.0 */
// 3×3 dice-face cell sets (cells 0..8, row-major) for 1–9 hosts; 10+ keeps 3 rows + adds columns.
const DICE: Record<number, ReadonlyArray<number>> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 3, 6, 2, 5, 8],
  7: [0, 3, 6, 2, 5, 8, 4],
  8: [0, 1, 2, 3, 5, 6, 7, 8],
  9: [0, 1, 2, 3, 4, 5, 6, 7, 8],
};

/** Grid placement (1-based row/col) for each host's pip: a die face for 1–9, else 3 rows × more cols. */
const pipLayout = (
  n: number,
): {
  readonly cols: number;
  readonly cells: ReadonlyArray<{ readonly row: number; readonly col: number }>;
} => {
  if (n <= 9) {
    const order = DICE[n] ?? [];
    return {
      cols: 3,
      cells: order.map((c) => ({ row: Math.floor(c / 3) + 1, col: (c % 3) + 1 })),
    };
  }
  const cols = Math.ceil(n / 3);
  return {
    cols,
    cells: Array.from({ length: n }, (_, i) => ({ row: (i % 3) + 1, col: Math.floor(i / 3) + 1 })),
  };
};

/** One host's pip in the die — a coloured dot placed at its cell, colour from its HostStatus. @since 1.0.0 */
const HostPip = (props: {
  readonly host: HostRef;
  readonly cell: { readonly row: number; readonly col: number };
}): React.ReactElement => {
  const r = useAtomValue(useHostBundle(props.host).status);
  const s = AsyncResult.isSuccess(r) ? r.value : undefined;
  React.useEffect(() => {
    if (AsyncResult.isFailure(r)) dlog("host", props.host.id, "FAILURE", Cause.pretty(r.cause));
    else dlog("host", props.host.id, asyncTag(r));
  }, [r, props.host.id]);
  return (
    <span
      className="rounded-full"
      style={{
        gridRow: props.cell.row,
        gridColumn: props.cell.col,
        backgroundColor: hostColor(s),
      }}
    />
  );
};

/** One host's row in the hosts panel — status + name + readiness; tap to open its full screen. @since 1.0.0 */
const HostRow = (props: {
  readonly host: HostRef;
  readonly onOpen: () => void;
}): React.ReactElement => {
  const r = useAtomValue(useHostBundle(props.host).status);
  const s = AsyncResult.isSuccess(r) ? r.value : undefined;
  return (
    <li>
      <button
        type="button"
        onClick={props.onOpen}
        className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-left hover:bg-muted"
      >
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: hostColor(s) }} />
        <span className="flex-1 truncate">{displayName(props.host.id)}</span>
        <span className="text-muted-foreground">
          {s !== undefined ? `${s.up ? s.status : "down"} · ${s.resourceCount}` : "…"}
        </span>
      </button>
    </li>
  );
};

/** The single host-status **die** button (top-right): one pip per host, coloured by its status — a die
 *  face for 1–9 hosts, then 3 rows + more columns. Tap to list the hosts (tap one → its full screen).
 *  Renders nothing for a hostless (local) group. @since 1.0.0 */
export const HostBar = (props: {
  readonly group: GroupNode;
  readonly onOpenHost: (host: HostRef) => void;
}): React.ReactElement | null => {
  const hosts = hostsOf(props.group);
  const ids = hosts.map((h) => h.id).join(", ");
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    dlog("hostBar: hosts =", hosts.length, ids === "" ? "(none)" : ids);
  }, [hosts.length, ids]);
  if (hosts.length === 0) return null;
  const layout = pipLayout(hosts.length);
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        aria-label={`${hosts.length} host${hosts.length === 1 ? "" : "s"}`}
        onClick={() => setOpen((o) => !o)}
        className="rounded-md border bg-card p-1.5 shadow-sm transition-transform active:scale-95"
      >
        <div
          className="grid gap-1"
          style={{
            gridTemplateColumns: `repeat(${layout.cols}, 0.375rem)`,
            gridTemplateRows: "repeat(3, 0.375rem)",
          }}
        >
          {hosts.map((h, i) => (
            <HostPip key={h.id} host={h} cell={layout.cells[i] ?? { row: 1, col: 1 }} />
          ))}
        </div>
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border bg-card p-2 text-xs shadow-lg">
          <div className="mb-1 font-semibold">hosts · {hosts.length}</div>
          <ul className="space-y-0.5">
            {hosts.map((h) => (
              <HostRow
                key={h.id}
                host={h}
                onOpen={() => {
                  setOpen(false);
                  props.onOpenHost(h);
                }}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
};

/** Fullscreen host view: header + each served resource's readiness (graphs land with host metrics).
 *  @since 1.0.0 */
export const HostDetail = (props: {
  readonly host: HostRef;
  readonly onBack: () => void;
}): React.ReactElement => {
  const r = useAtomValue(useHostBundle(props.host).status);
  const s = AsyncResult.isSuccess(r) ? r.value : undefined;
  const color = hostColor(s);
  return (
    <div className="flex h-[100dvh] flex-col gap-3 overflow-hidden safe-area landscape:h-auto landscape:min-h-[100dvh] landscape:overflow-visible">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={props.onBack}>
          ← back
        </Button>
        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
        <strong className="flex-1 truncate text-base">{displayName(props.host.id)}</strong>
        <span className="text-sm text-muted-foreground">{s !== undefined ? (s.up ? s.status : "down") : "…"}</span>
      </div>
      {s !== undefined ? (
        <>
          <div className="flex gap-3">
            <Stat label="uptime" value={fmtUptime(s.uptimeMillis)} />
            <Stat label="resources" value={String(s.resourceCount)} />
            <Stat label="status" value={s.status} />
          </div>
          <div className="overflow-auto rounded-xl border bg-card p-3">
            <div className="mb-2 text-sm font-semibold">resources</div>
            <ul className="space-y-1">
              {s.resources.map((res) => (
                <li key={res.key} className="flex items-center gap-2 text-sm">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: res.ready ? "#22c55e" : "#eab308" }}
                  />
                  <span className="flex-1 truncate">{displayName(res.key)}</span>
                  <Badge>{displayName(res.kind)}</Badge>
                  <span className="text-muted-foreground">
                    {res.ready ? "ready" : (res.detail ?? "not ready")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {/* Pass 2: host metrics graphs (CPU / mem / throughput) land here with HostStatus.metrics. */}
        </>
      ) : (
        <div className="text-muted-foreground">connecting to host…</div>
      )}
    </div>
  );
};

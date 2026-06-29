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
import { DateTime } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { Lock, LockOpen, Pause, Play, Plus, Power, RotateCw, Square, Trash2, X } from "lucide-react";
import * as Group from "../Group";
import {
  type CommandAtom,
  type GroupNode,
  type LogLine,
  type MetricPoint,
  type ProcessBundle,
  type ProcessTag,
  type QueueBundle,
  type QueueTag,
  type ScheduleEntry,
  kindOf,
  leafTags,
  queueLeaves,
} from "./data";
import { useProcessBundle, useQueueBundle } from "./runtime";
import { useAtomSet, useAtomValue } from "../ui/atom-react";
import { useViewTransitionStyle } from "./useViewTransition";
import { dlog } from "./debug-console";
import { dateFromMillis, fmtClock, millisFromLocalInput, now } from "./now";
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

/** Dispatch a group member to its card (group / queue / process). @since 1.0.0 */
export const Cell = (props: {
  readonly member: unknown;
  /** Display name — the member key under which the current group holds this member. */
  readonly name: string;
  readonly onOpenLeaf: (tag: QueueTag | ProcessTag) => void;
  readonly onOpenGroup: (g: GroupNode) => void;
}): React.ReactElement => {
  if (Group.isGroup(props.member)) {
    return <GroupCard node={props.member as GroupNode} name={props.name} onOpen={props.onOpenGroup} />;
  }
  return kindOf(props.member) === "process" ? (
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
const LockToggle = (props: { readonly locked: boolean; readonly onToggle: () => void }): React.ReactElement => {
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
 *  state, a lock, and confirm on stop. @since 1.0.0 */
export const ProcessControls = (props: { readonly bundle: ProcessBundle }): React.ReactElement => {
  const statusR = useAtomValue(props.bundle.status);
  const s = AsyncResult.isSuccess(statusR) ? statusR.value : undefined;
  const up = s?.supervising === true;
  const [locked, setLocked] = React.useState(true);
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
      <LockToggle locked={locked} onToggle={() => setLocked((l) => !l)} />
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

/** View + edit a process's schedule (the run windows that arm it). Reads the current entries,
 *  then `setSchedule`/`clearSchedule` to mutate — locked by default; unlock to edit. Edits apply
 *  optimistically (the schedule is read once on open). @since 1.0.0 */
export const ScheduleEditor = (props: { readonly bundle: ProcessBundle }): React.ReactElement => {
  const loadedR = useAtomValue(props.bundle.schedule);
  const loaded = AsyncResult.isSuccess(loadedR) ? loadedR.value : undefined;
  const setSchedule = useAtomSet(props.bundle.setSchedule);
  const clearSchedule = useAtomSet(props.bundle.clearSchedule);
  const [edited, setEdited] = React.useState<ReadonlyArray<ScheduleEntry> | undefined>(undefined);
  const [start, setStart] = React.useState("");
  const [stop, setStop] = React.useState("");
  const [locked, setLocked] = React.useState(true);
  const [confirmClear, setConfirmClear] = React.useState(false);

  const list = edited ?? loaded ?? [];

  const apply = (next: ReadonlyArray<ScheduleEntry>): void => {
    setEdited(next);
    setSchedule(next);
  };
  const add = (): void => {
    const s = millisFromLocalInput(start);
    if (s === undefined) return;
    const e = millisFromLocalInput(stop);
    const entry: ScheduleEntry = {
      startAt: DateTime.makeUnsafe(s),
      ...(e !== undefined ? { stopAt: DateTime.makeUnsafe(e) } : {}),
    };
    apply([...list, entry].sort((a, b) => DateTime.toEpochMillis(a.startAt) - DateTime.toEpochMillis(b.startAt)));
    setStart("");
    setStop("");
  };
  const remove = (i: number): void => apply(list.filter((_, j) => j !== i));
  const clearAll = (): void => {
    setEdited([]);
    clearSchedule();
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-card p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>SCHEDULE · {list.length} window{list.length === 1 ? "" : "s"}</span>
        <span className="ml-auto">
          <LockToggle locked={locked} onToggle={() => setLocked((l) => !l)} />
        </span>
      </div>

      {list.length === 0 ? (
        <div className="text-xs text-muted-foreground">No run windows — the process is disarmed.</div>
      ) : (
        <ul className="flex flex-col gap-1">
          {list.map((entry, i) => (
            <li key={`${DateTime.toEpochMillis(entry.startAt)}-${i}`} className="flex items-center gap-2 text-sm">
              <span className="tabular-nums">{fmtWhen(entry.startAt)}</span>
              <span className="text-muted-foreground">→ {entry.stopAt === undefined ? "open-ended" : fmtWhen(entry.stopAt)}</span>
              <button
                type="button"
                onClick={() => remove(i)}
                disabled={locked}
                className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-40"
                aria-label="remove window"
                title="remove window"
              >
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-2 border-t pt-2">
        <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          start
          <input
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            disabled={locked}
            className="rounded-md border bg-background px-2 py-1 text-sm text-foreground disabled:opacity-40"
          />
        </label>
        <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          stop (optional)
          <input
            type="datetime-local"
            value={stop}
            onChange={(e) => setStop(e.target.value)}
            disabled={locked}
            className="rounded-md border bg-background px-2 py-1 text-sm text-foreground disabled:opacity-40"
          />
        </label>
        <Button variant="outline" size="sm" onClick={add} disabled={locked || millisFromLocalInput(start) === undefined}>
          <Plus className="size-4" /> add
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setConfirmClear(true)}
          disabled={locked || list.length === 0}
          className="ml-auto"
        >
          <Trash2 className="size-4" /> clear
        </Button>
      </div>

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear schedule?"
        description="Remove all run windows. The process disarms until new windows are added."
        confirmLabel="Clear"
        destructive
        onConfirm={clearAll}
      />
    </div>
  );
};

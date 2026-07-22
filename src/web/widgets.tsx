/**
 * @module web/widgets
 *
 * Hand-crafted, per-type dashboard widgets — the building blocks the `<Dashboard>` and its
 * mobile/desktop views compose. Each is driven by a **tag** (its bundle comes from
 * `useQueueBundle` / `useProcessBundle` over the context runtime); the tree is a `Group.Tag`
 * walked with `Group.members` / `Group.isGroup`.
 *
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
import { Cause, DateTime, HashMap, Option } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { Lock, LockOpen, Maximize2, Pause, Play, Power, RotateCw, Square, Trash2 } from "lucide-react";
import * as Group from "../Group";
import {
  type ApiBundle,
  type ApiPoint,
  type ApiTag,
  type CommandAtom,
  type CustomQueueTag,
  type FleetHealthTag,
  type TelemetryTag,
  type ShardMapTag,
  type RunTag,
  type GroupNode,
  type LogLine,
  type MetricPoint,
  type ProcessBundle,
  type ProcessTag,
  type QueueBundle,
  type QueueTag,
  type ScheduleEntry,
  type NodeRef,
  isApiTag,
  isCustomQueueTag,
  isFleetHealthTag,
  isTelemetryTag,
  isShardMapTag,
  isRunTag,
  isProcessTag,
  isQueueTag,
  nodesOf,
  leafTags,
  queueLeaves,
  resourceNodeRef,
  tagWireKey,
} from "./data";
import { kindOf as resourceKindOf, kind as resourceKind } from "../Hyperlink";
import { kind as queueKind } from "../QueueResource";
import { kind as customQueueKind } from "../CustomQueueResource";
import { kind as fleetHealthKind, type NodeReport } from "../FleetHealth";
import { kind as telemetryKind, type MetricDatum } from "../Telemetry";
import { kind as shardMapKind } from "../ShardMap";
import { kind as runKind } from "../RunResource";
import { kind as processKind } from "../Process";
import { kind as apiKind } from "../ApiMetrics";
import {
  type LeafTag,
  type Widget,
  type WidgetProps,
  type WidgetRegistry,
  forKind,
  isLeafTag,
  useWidgets,
  widgetFor,
  withEntries,
} from "./widget-registry";
import type { ApiUsageMetrics } from "../ApiUsageSchema";
import type { Status as NodeStatusValue } from "../NodeStatus";
import { useApiBundle, useCustomQueueBundle, useFleetHealthBundle, useNodeBundle, useProcessBundle, useQueueBundle, useRunBundle, useShardMapBundle, useTelemetryBundle } from "./runtime";
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

/** Last path segment of a tag/group id. */
export const displayName = (key: string): string => key.split("/").pop() ?? key;
/** Format milliseconds as seconds. */
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

/** Phase → label + colour. */
export const STATUS: Record<string, { label: string; color: string }> = {
  running: { label: "running", color: "#22c55e" },
  paused: { label: "paused", color: "#eab308" },
  draining: { label: "draining", color: "#06b6d4" },
  off: { label: "off", color: "#ef4444" },
};
/** Resolve the status key from phase + paused. */
export const statusKey = (phase: string, paused: boolean): string =>
  phase === "off" ? "off" : phase === "draining" ? "draining" : paused ? "paused" : "running";

const PRIO = { high: "#ef4444", normal: "#94a3b8", low: "#3b82f6" } as const;
const LEVEL: Record<string, string> = {
  Info: "#cbd5e1",
  Warning: "#eab308",
  Error: "#ef4444",
  Fatal: "#ef4444",
};

/** A coloured status pill. */
export const StatusBadge = (props: { readonly phase: string; readonly paused: boolean }): React.ReactElement => {
  const s = STATUS[statusKey(props.phase, props.paused)] ?? STATUS.running!;
  return <Badge color={s.color}>{s.label}</Badge>;
};

/** Running / stopped pill for a process — from its live `supervising` flag. Shared by the process
 *  card and its detail header. @public */
export const ProcessStatusBadge = (props: { readonly supervising: boolean | undefined }): React.ReactElement => (
  <Badge color={props.supervising === true ? "#22c55e" : "#94a3b8"}>
    {props.supervising === true ? "running" : "stopped"}
  </Badge>
);

/** Health pill for an API-metrics resource — green / amber / red by error rate ({@link apiHealth}).
 *  Shared by the API card and its detail header. @public */
export const ApiStatusBadge = (props: {
  readonly requests: number;
  readonly errors: number;
}): React.ReactElement => {
  const health = apiHealth(props.requests, props.errors);
  return <Badge color={health.color}>{health.label}</Badge>;
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
  readonly tag: QueueTag;
  /** Display name — the member key under which the parent group holds this tag. */
  readonly name: string;
  readonly selected?: boolean;
  readonly onOpen: (tag: QueueTag) => void;
}): React.ReactElement => {
  const vt = useViewTransitionStyle(`res-${props.tag.key}`);
  const r = useAtomValue(useQueueBundle(props.tag).status);
  const s = AsyncResult.isSuccess(r) ? Option.getOrUndefined(r.value) : undefined;
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
        "relative flex flex-col rounded-xl border bg-card p-3 text-left transition-colors hover:border-ring",
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
      <DegradedOverlay tag={props.tag} />
    </button>
  );
};

/** One named lane as a labelled bar — the custom-queue counterpart to `PrioRow` (fixed high/normal/low);
 *  lanes are arbitrary, so the label is the lane name. */
const LaneRow = (props: {
  readonly lane: string;
  readonly count: number;
  readonly max: number;
}): React.ReactElement => (
  <div className="flex items-center gap-2 text-xs">
    <span className="w-16 shrink-0 truncate text-muted-foreground">{props.lane}</span>
    <Bar value={props.count} max={props.max} color="#3b82f6" />
    <span className="w-8 shrink-0 text-right">{props.count}</span>
  </div>
);

/** Custom-queue phase colours (running / draining / off) — its phase set differs from a queue's. */
const CQ_PHASE: Record<string, string> = { running: "#22c55e", draining: "#eab308", off: "#94a3b8" };

/**
 * A **custom queue** as a grid card — the {@link QueueCard} sibling for `CustomQueueResource`: same
 * pending / done / phase, but its **named lanes** (`status.sizes`, an arbitrary set) render one bar
 * each instead of the fixed high/normal/low priorities. @public
 */
export const CustomQueueCard = (props: {
  readonly tag: CustomQueueTag;
  /** Display name — the member key under which the parent group holds this tag. */
  readonly name: string;
  readonly selected?: boolean;
  readonly onOpen: (tag: CustomQueueTag) => void;
}): React.ReactElement => {
  const vt = useViewTransitionStyle(`res-${props.tag.key}`);
  const r = useAtomValue(useCustomQueueBundle(props.tag).status);
  const s = AsyncResult.isSuccess(r) ? Option.getOrUndefined(r.value) : undefined;
  const lanes = s !== undefined ? Object.entries(s.sizes) : [];
  const pending = lanes.reduce((sum, [, n]) => sum + n, 0);
  const max = Math.max(1, ...lanes.map(([, n]) => n));
  const paused = s?.paused === true;
  return (
    <button
      type="button"
      onClick={() => props.onOpen(props.tag)}
      style={vt}
      className={cn(
        "relative flex flex-col rounded-xl border bg-card p-3 text-left transition-colors hover:border-ring",
        props.selected === true && "border-primary",
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <strong className="flex-1 truncate">{props.name}</strong>
        <Badge color={paused ? "#eab308" : CQ_PHASE[s?.phase ?? "running"] ?? "#22c55e"}>
          {paused ? "paused" : s?.phase ?? "running"}
        </Badge>
      </div>
      <div className="mb-2 flex justify-between text-xs text-muted-foreground">
        <span>pending <strong className="text-foreground">{pending}</strong></span>
        <span>{s?.completed ?? 0} done</span>
      </div>
      <div className="flex flex-col gap-1">
        {lanes.length === 0 ? (
          <div className="text-xs text-muted-foreground">no lanes</div>
        ) : (
          lanes.slice(0, 5).map(([lane, count]) => <LaneRow key={lane} lane={lane} count={count} max={max} />)
        )}
      </div>
      <DegradedOverlay tag={props.tag} />
    </button>
  );
};

const MemberRow = (props: { readonly tag: QueueTag; readonly name: string }): React.ReactElement => {
  const r = useAtomValue(useQueueBundle(props.tag).status);
  const s = AsyncResult.isSuccess(r) ? Option.getOrUndefined(r.value) : undefined;
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

/** Invisible: reads ONE node's `NodeStatus` and reports how many of the group's leaves **on that
 *  node** are degraded, so {@link GroupCard} can sum them for its aggregate badge. A child-level hook
 *  (not a `.map` over the node list) keeps a constant hook order if a group ever gains/loses a node —
 *  the same Rules-of-Hooks pattern {@link HealthBoard} uses. */
const NodeDegradedProbe = (props: {
  readonly node: NodeRef;
  readonly leafKeys: ReadonlySet<string>;
  readonly onCount: (id: string, count: number) => void;
}): null => {
  const r = useAtomValue(useNodeBundle(props.node).status);
  const s = AsyncResult.isSuccess(r) ? r.value : undefined;
  const count = (s?.resources ?? []).filter((x) => !x.ready && props.leafKeys.has(x.key)).length;
  const { onCount, node } = props;
  React.useEffect(() => onCount(node.id, count), [onCount, node.id, count]);
  return null;
};

/** A subgroup as a grid widget — tap opens it as its own page (drill-down). */
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
  // Aggregate readiness across the group's leaves — which may span several nodes. Each node reports its
  // degraded-leaf count up (via a hidden probe); the badge shows the total, only when non-zero.
  const nodes = nodesOf(props.node);
  const leafKeys = React.useMemo(
    () => new Set(leafTags(props.node).map(tagWireKey).filter((k): k is string => k !== undefined)),
    [props.node],
  );
  const [counts, setCounts] = React.useState<ReadonlyMap<string, number>>(() => new Map());
  const report = React.useCallback((id: string, count: number): void => {
    setCounts((prev) => {
      if (prev.get(id) === count) return prev;
      const next = new Map(prev);
      next.set(id, count);
      return next;
    });
  }, []);
  const degraded = nodes.reduce((sum, node) => sum + (counts.get(node.id) ?? 0), 0);
  return (
    <button
      type="button"
      onClick={() => props.onOpen(props.node)}
      style={vt}
      className="relative flex flex-col rounded-xl border border-[#06b6d455] bg-card p-3 text-left transition-colors hover:border-ring"
    >
      {nodes.map((node) => (
        <NodeDegradedProbe key={node.id} node={node} leafKeys={leafKeys} onCount={report} />
      ))}
      {degraded > 0 ? (
        <div className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-amber-500" />
      ) : null}
      <div className="mb-2 flex items-center gap-2">
        <strong className="min-w-0 flex-1 truncate text-[#06b6d4]">▸ {props.name}</strong>
        {degraded > 0 ? (
          <span
            className="shrink-0 rounded-full px-2 py-0.5 text-[0.7rem] font-medium text-amber-50"
            style={{ backgroundColor: "rgba(146,64,14,0.95)" }}
          >
            {degraded} of {leafTags(props.node).length} degraded
          </span>
        ) : (
          <span className="shrink-0 text-xs text-muted-foreground">
            {leafTags(props.node).length} resources
          </span>
        )}
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

/** Dispatch a group member to its card (group / queue / process / api). */
export const Cell = (props: {
  readonly member: unknown;
  /** Display name — the member key under which the current group holds this member. */
  readonly name: string;
  readonly onOpenLeaf: (tag: LeafTag) => void;
  readonly onOpenGroup: (g: GroupNode) => void;
}): React.ReactElement => {
  const registry = useWidgets();
  if (Group.isGroup(props.member)) {
    return <GroupCard node={props.member} name={props.name} onOpen={props.onOpenGroup} />;
  }
  // A non-group member is a resource tag; resolve its widget by key → kind → fallback.
  if (!isLeafTag(props.member)) return <></>;
  const tag = props.member;
  const Widget = widgetFor(registry, tag.key, resourceKindOf(tag) ?? resourceKind);
  return <Widget tag={tag} name={props.name} onOpen={props.onOpenLeaf} />;
};

const DegradedOverlayInner = (props: {
  readonly tag: unknown;
  readonly node: NodeRef;
}): React.ReactElement | null => {
  const r = useAtomValue(useNodeBundle(props.node).status);
  const s = AsyncResult.isSuccess(r) ? r.value : undefined;
  const stale = useStale(s?.uptimeMillis);
  // Node stopped responding: dim the frozen card + say so. Priority over "degraded" — once the stream
  // is dead, the last readiness is itself stale, so "not responding" is the honest signal.
  if (stale) {
    return (
      <>
        <div className="pointer-events-none absolute inset-0 rounded-xl bg-background/55 ring-1 ring-slate-500" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1.5 rounded-b-xl bg-slate-700/95 px-2 py-1 text-[0.72rem] font-medium text-slate-100">
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-slate-300" />
          <span className="min-w-0 flex-1 truncate">not responding — showing last update</span>
        </div>
      </>
    );
  }
  const readiness = s?.resources.find((x) => x.key === tagWireKey(props.tag));
  if (readiness === undefined || readiness.ready) return null; // ready / still loading → no overlay
  return (
    <>
      {/* amber ring on the whole card — scannable across the grid, no layout shift */}
      <div className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-amber-500" />
      {/* the root cause, as a strip over the card's bottom edge */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1.5 rounded-b-xl px-2 py-1 text-[0.72rem] font-medium text-amber-50"
        style={{ backgroundColor: "rgba(146, 64, 14, 0.95)" }}
      >
        <span className="shrink-0">⚠ degraded</span>
        {readiness.detail !== undefined ? (
          <span className="min-w-0 flex-1 truncate">— {readiness.detail}</span>
        ) : null}
      </div>
    </>
  );
};

/** The card **problem overlay**, read from the resource's node `NodeStatus` (SSOT): a slate dim +
 *  "not responding" when the node's heartbeat stalls (its data is frozen), else an amber ring +
 *  "degraded — <cause>" when the resource isn't ready. Absolute (no layout shift), works for every
 *  card type; nothing while live-and-ready, loading, or nodeless. @public */
export const DegradedOverlay = (props: { readonly tag: unknown }): React.ReactElement | null => {
  const node = resourceNodeRef(props.tag);
  if (node === undefined) return null;
  return <DegradedOverlayInner tag={props.tag} node={node} />;
};

/** A labelled stat card. */
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
  const s = AsyncResult.isSuccess(statusR) ? Option.getOrUndefined(statusR.value) : undefined;
  const m = AsyncResult.isSuccess(metricsR) ? Option.getOrUndefined(metricsR.value) : undefined;
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
// (server) timestamp, so the curve's span actually changes (backed by the node's history store).
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
 *  history-backed series — a compact toggle that cycles the time window (1m→15m→1h). */
export const MetricChart = (props: {
  readonly bundle: {
    readonly history: QueueBundle["history"];
    readonly trend: QueueBundle["trend"];
  };
}): React.ReactElement => {
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

/** A modal confirmation dialog — for destructive / guarded actions. */
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
 *  `confirm` opens a modal dialog before firing; `disabled` for the lock. */
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
 *  unlocking opens a confirm dialog so the guard isn't fat-fingered off. */
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
 *  state, a lock (locked by default), and confirm on the destructive actions. */
export const QueueControls = (props: { readonly bundle: QueueBundle }): React.ReactElement => {
  const statusR = useAtomValue(props.bundle.status);
  const s = AsyncResult.isSuccess(statusR) ? Option.getOrUndefined(statusR.value) : undefined;
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

/** The live log stream (auto-scrolls to newest). Works for any bundle with `logs`. */
/** Effect log levels, low→high — for the min-level filter. Unknown levels rank as `info`. */
const LEVEL_RANK: Record<string, number> = { trace: 0, debug: 1, info: 2, warn: 3, warning: 3, error: 4, fatal: 5 };
const levelRank = (level: string): number => LEVEL_RANK[level.toLowerCase()] ?? 2;
const MIN_LEVELS = ["all", "info", "warn", "error"] as const;

export const LogStream = (props: {
  readonly bundle: { readonly logs: QueueBundle["logs"] };
  readonly className?: string;
}): React.ReactElement => {
  const r = useAtomValue(props.bundle.logs);
  React.useEffect(() => dlog("logs", asyncTag(r)), [r]);
  const all: ReadonlyArray<LogLine> = AsyncResult.isSuccess(r) ? r.value : [];
  // client-side filter: substring match on the message + a minimum level
  const [query, setQuery] = React.useState("");
  const [min, setMin] = React.useState<(typeof MIN_LEVELS)[number]>("all");
  const needle = query.trim().toLowerCase();
  const floor = min === "all" ? 0 : levelRank(min);
  const logs = all.filter(
    (l) => levelRank(l.level) >= floor && (needle === "" || l.message.toLowerCase().includes(needle)),
  );
  const filtered = needle !== "" || min !== "all";
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [logs.length]);
  return (
    <div className={cn("flex flex-col text-xs", props.className)}>
      <div className="flex items-center gap-2 border-b px-2 py-1">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="filter logs…"
          className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-xs outline-none placeholder:text-muted-foreground"
        />
        <select
          value={min}
          onChange={(e) => setMin(e.target.value as (typeof MIN_LEVELS)[number])}
          className="shrink-0 rounded border bg-transparent px-1 py-0.5 text-xs"
          aria-label="minimum log level"
        >
          {MIN_LEVELS.map((lvl) => (
            <option key={lvl} value={lvl}>{lvl === "all" ? "all levels" : `${lvl}+`}</option>
          ))}
        </select>
        {filtered ? (
          <span className="shrink-0 tabular-nums text-muted-foreground">{logs.length}/{all.length}</span>
        ) : null}
      </div>
      <div ref={ref} className="min-h-0 flex-1 overflow-auto py-1">
        {logs.length === 0 ? (
          <div className="px-2 py-1 text-muted-foreground">{all.length === 0 ? "no logs yet" : "no lines match"}</div>
        ) : (
          logs.map((l) => (
            <div key={l.id} className="flex gap-2 px-2 py-0.5">
              <span className="w-16 shrink-0 whitespace-nowrap tabular-nums text-muted-foreground">{fmtClock(l.t)}</span>
              <span className="w-11 shrink-0 truncate" style={{ color: LEVEL[l.level] ?? "#cbd5e1" }}>{l.level}</span>
              <span className="break-all">{l.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

// ── process widgets ──────────────────────────────────────────────────────────

/** A process as a grid card — supervision state + active instances. */
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
      className="relative flex flex-col rounded-xl border bg-card p-3 text-left transition-colors hover:border-ring"
    >
      <div className="mb-2 flex items-center gap-2">
        <span>⚙</span>
        <strong className="flex-1 truncate">{props.name}</strong>
        <ProcessStatusBadge supervising={s?.supervising} />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{s?.armed === true ? "armed" : "disarmed"}</span>
        <span><strong className="text-foreground">{s?.activeInstances ?? 0}</strong> active</span>
      </div>
      <DegradedOverlay tag={props.tag} />
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

/** Process controls: icon buttons, start/stop folded into one toggle on the live `supervising`
 *  state, a lock, and confirm on stop. The lock is hoisted (one lock guards both these controls
 *  and the {@link ScheduleEditor}), so the caller owns `locked` / `onToggleLock`. */
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
      <ActionButton atom={props.bundle.run} label="run now" icon={<RotateCw className="size-4" />} disabled={locked} />
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
 *  is given it's an edit (fields pre-filled, `onDelete` shown); otherwise it adds. */
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
 *  read once on open); adding a window is a popup. */
/** The shared edit state for a process schedule — the current entries plus add/remove/clear, applied
 *  optimistically (the schedule reads once on open). Used by both the inline {@link ScheduleEditor}
 *  and the fullscreen week view. */
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
 *  windows fill to the end of each day from their start. */
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
 *  happens. */
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
 *  {@link ApiStats}. */
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

/**
 * One measured block in an **auto-paginated** {@link Deck}. The deck measures each section and packs
 * them into as many pages as the viewport needs — a section that won't fit starts the next page, and
 * everything that fits stays on one (no dots). @public
 */
export interface DeckSection {
  /** Stable identity — used as the React key and to detect content changes for re-measuring. */
  readonly key: string;
  /** The block. **Fixed** sections (default) are rendered twice — once hidden to measure — so keep
   *  content side-effect-free (no mount effects); prefer reading atoms in the parent and passing
   *  plain JSX. Mark live/hook-heavy blocks (charts, logs) `grow` so they're measured as a spacer. */
  readonly content: React.ReactNode;
  /** Flex to fill the leftover height on its page (charts, logs, long lists). A grow section is
   *  packed by {@link minHeight} and stretched beyond it; its content is never measured. */
  readonly grow?: boolean;
  /** Packing height for a `grow` section (default 160). The height it claims before stretching. */
  readonly minHeight?: number;
}

const DECK_GAP = 12; // px — matches the `gap-3` between sections
const DECK_GROW_MIN = 160; // default packing height for a grow section
const DECK_DOTS = 20; // px reserved for the dot gutter (kept constant so packing doesn't oscillate)

/** Greedily pack section heights into pages that each fit `avail`, returning groups of indices. A
 *  section taller than a page still gets its own page (it scrolls within). */
const packSections = (
  heights: ReadonlyArray<number>,
  avail: number,
): ReadonlyArray<ReadonlyArray<number>> => {
  const pages: Array<Array<number>> = [];
  let cur: Array<number> = [];
  let used = 0;
  heights.forEach((h, i) => {
    const next = cur.length === 0 ? h : used + DECK_GAP + h;
    if (cur.length > 0 && next > avail) {
      pages.push(cur);
      cur = [i];
      used = h;
    } else {
      cur.push(i);
      used = next;
    }
  });
  if (cur.length > 0) pages.push(cur);
  return pages.length > 0 ? pages : [[]];
};

/** Track the active page (nearest child by scroll offset) and expose a smooth `scrollTo`. */
const useDeckScroll = (): {
  readonly ref: React.RefObject<HTMLDivElement | null>;
  readonly active: number;
  readonly onScroll: () => void;
  readonly scrollTo: (i: number) => void;
} => {
  const ref = React.useRef<HTMLDivElement>(null);
  const [active, setActive] = React.useState(0);
  const onScroll = React.useCallback((): void => {
    const el = ref.current;
    if (el === null) return;
    // nearest page by element offset — robust to the inter-page gap (clientWidth math isn't).
    let best = 0;
    let bestD = Infinity;
    Array.from(el.children).forEach((c, i) => {
      if (c instanceof HTMLElement) {
        const d = Math.abs(c.offsetLeft - el.scrollLeft);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    });
    setActive(best);
  }, []);
  const scrollTo = React.useCallback((i: number): void => {
    const el = ref.current;
    const child = el?.children[i];
    if (el !== null && child instanceof HTMLElement) {
      el.scrollTo({ left: child.offsetLeft, behavior: "smooth" });
    }
  }, []);
  return { ref, active, onScroll, scrollTo };
};

/** The dot row — one filled dot per page, tap to jump. Hidden for a single page. */
const DeckDots = (props: {
  readonly count: number;
  readonly active: number;
  readonly onDot: (i: number) => void;
  readonly className?: string;
}): React.ReactElement | null =>
  props.count > 1 ? (
    <div className={cn("flex justify-center gap-1", props.className)}>
      {Array.from({ length: props.count }, (_, i) => (
        <button
          key={i}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            props.onDot(i);
          }}
          className={cn("size-1.5 rounded-full transition-colors", i === props.active ? "bg-foreground" : "bg-muted-foreground/40")}
          aria-label={`page ${i + 1}`}
        />
      ))}
    </div>
  ) : null;

/**
 * A swipeable **deck** of pages: a horizontal scroll-snap track + dot indicators. Two forms:
 *
 * - **card** (default) — a tap-to-open grid card; pass explicit `pages`. Tap fires `onOpen`; a swipe
 *   scrolls instead. Natural height.
 * - **fill** (`fill`) — fills its flex parent (a detail body). Pass `sections` and it **auto-packs**
 *   them into pages by measuring against the viewport (grow sections stretch to fill leftover space,
 *   short all-fixed pages center); or pass explicit `pages` as an escape hatch.
 *
 * @public
 */
export const Deck = (props: {
  /** Explicit pages (required for a card; an escape hatch for `fill`). */
  readonly pages?: ReadonlyArray<React.ReactNode>;
  /** Auto-paginated sections (fill only) — measured + packed into pages. */
  readonly sections?: ReadonlyArray<DeckSection>;
  /** Fill the flex parent (detail body) instead of sizing to content (grid card). */
  readonly fill?: boolean;
  /** Card tap-to-open (card form only). */
  readonly onOpen?: () => void;
  /** Absolute overlay over the deck (root is `relative`) — e.g. a degraded treatment. */
  readonly overlay?: React.ReactNode;
  readonly style?: React.CSSProperties;
  readonly className?: string;
}): React.ReactElement => {
  const { ref, active, onScroll, scrollTo } = useDeckScroll();
  const sections = props.sections;
  const [groups, setGroups] = React.useState<ReadonlyArray<ReadonlyArray<number>>>(
    () => (sections !== undefined ? [sections.map((_, i) => i)] : []),
  );
  const measureRefs = React.useRef<Array<HTMLDivElement | null>>([]);
  const keysDep = sections?.map((s) => s.key).join("|");
  React.useLayoutEffect(() => {
    if (sections === undefined) return;
    const el = ref.current;
    if (el === null) return;
    const remeasure = (): void => {
      const avail = Math.max(1, el.clientHeight - DECK_DOTS);
      const heights = sections.map((s, i) =>
        s.grow === true ? s.minHeight ?? DECK_GROW_MIN : measureRefs.current[i]?.offsetHeight ?? 0,
      );
      setGroups(packSections(heights, avail));
    };
    remeasure();
    const ro = new ResizeObserver(remeasure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sections, ref, keysDep]);

  const pageNodes: ReadonlyArray<React.ReactNode> =
    props.pages ??
    (sections !== undefined
      ? groups.map((grp, gi) => {
          const hasGrow = grp.some((si) => sections[si]?.grow === true);
          return (
            <div key={gi} className={cn("flex h-full flex-col gap-3", !hasGrow && "justify-center")}>
              {grp.map((si) => {
                const s = sections[si];
                return s === undefined ? null : (
                  <div key={s.key} className={s.grow === true ? "flex min-h-0 flex-1 flex-col" : "shrink-0"}>
                    {s.content}
                  </div>
                );
              })}
            </div>
          );
        })
      : []);

  const track = (
    <div
      ref={ref}
      onScroll={onScroll}
      className={cn(
        "flex snap-x snap-mandatory gap-4 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        props.fill === true && "min-h-0 flex-1",
      )}
    >
      {pageNodes.map((page, i) => (
        <div key={i} className={cn("w-full shrink-0 snap-center", props.fill === true && "flex flex-col overflow-y-auto")}>
          {page}
        </div>
      ))}
    </div>
  );
  // fill: pull the dot row down into the bottom safe-area padding with a negative margin so it sits
  // near the screen edge — the track keeps its reserved `DECK_DOTS` height (no stretch change).
  const dots = (
    <DeckDots count={pageNodes.length} active={active} onDot={scrollTo} className={props.fill === true ? "h-5 shrink-0 items-center mt-3 -mb-3" : "mt-2"} />
  );
  // hidden measurer (fill + sections): fixed sections render their real (pure) content to be sized;
  // grow sections render a minHeight spacer, so their live/stateful content is never double-mounted.
  // Zero-height + overflow-hidden so the stacked sections are clipped and add **nothing** to the
  // container's scrollHeight (a tall absolute measurer otherwise makes the detail scroll on iOS).
  // Block layout (not flex) so each child keeps its natural height for `offsetHeight`.
  const measurer =
    sections !== undefined ? (
      <div aria-hidden className="pointer-events-none invisible absolute left-0 top-0 h-0 w-full overflow-hidden">
        {sections.map((s, i) => (
          <div
            key={s.key}
            ref={(el) => {
              measureRefs.current[i] = el;
            }}
          >
            {s.grow === true ? <div style={{ height: s.minHeight ?? DECK_GROW_MIN }} /> : s.content}
          </div>
        ))}
      </div>
    ) : null;

  if (props.fill === true) {
    return (
      <div className={cn("relative flex min-h-0 flex-1 flex-col", props.className)} style={props.style}>
        {measurer}
        {track}
        {dots}
        {props.overlay}
      </div>
    );
  }
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={props.onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") props.onOpen?.();
      }}
      style={props.style}
      className={cn(
        "relative flex flex-col rounded-xl border bg-card p-3 text-left transition-colors hover:border-ring focus-visible:border-ring focus-visible:outline-none",
        props.className,
      )}
    >
      {track}
      {dots}
      {props.overlay}
    </div>
  );
};

/**
 * A **fullscreen detail** shell — a standard header (back + icon/title + optional badge + readiness
 * banner) over an auto-paginating {@link Deck}. Hand it an ordered list of `sections` and it packs
 * them into as many pages as the viewport needs (one → no dots); or pass explicit `pages` as an
 * escape hatch. Gives a resource more room than its grid card. @public
 */
export const DetailScreen = (props: {
  readonly title: string;
  readonly onBack: () => void;
  /** View-transition key — pass `res-${tag.key}` so the card↔detail morph matches the grid. */
  readonly vtKey: string;
  readonly icon?: React.ReactNode;
  readonly badge?: React.ReactNode;
  /** Renders a {@link ResourceReadinessBanner} for this tag (no-op when the tag has no node). */
  readonly readinessTag?: unknown;
  /** Auto-paginated content — the common case. */
  readonly sections?: ReadonlyArray<DeckSection>;
  /** Explicit pages — an escape hatch when you want a hard page break. */
  readonly pages?: ReadonlyArray<React.ReactNode>;
}): React.ReactElement => {
  const vt = useViewTransitionStyle(props.vtKey);
  return (
    <div className="flex h-[100dvh] flex-col gap-3 overflow-hidden safe-area landscape:h-auto landscape:min-h-[100dvh] landscape:overflow-visible" style={vt}>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={props.onBack}>← back</Button>
        <strong className="flex-1 truncate text-base">
          {props.icon !== undefined ? <>{props.icon} </> : null}{props.title}
        </strong>
        {props.badge}
      </div>
      {props.readinessTag !== undefined ? <ResourceReadinessBanner tag={props.readinessTag} /> : null}
      <Deck fill sections={props.sections} pages={props.pages} />
    </div>
  );
};

/** Top endpoints (busiest first) from the latest window, or the snapshot's `topEndpoints`. */
const topEndpoints = (
  bundle: { readonly requests: number; readonly errors: number; readonly endpoint: string }[],
  limit: number,
): ReadonlyArray<{ readonly endpoint: string; readonly requests: number; readonly errors: number }> =>
  [...bundle].sort((a, b) => b.requests - a.requests).slice(0, limit);

/** An API-metrics resource as a grid card — a {@link Deck}: page 1 is throughput + health, page 2
 *  is the busiest endpoints. Read-only. */
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
  const m = AsyncResult.isSuccess(metricsR) ? Option.getOrUndefined(metricsR.value) : undefined;
  const history = AsyncResult.isSuccess(historyR) ? historyR.value : [];
  const health = apiHealth(s?.requestsTotal ?? 0, s?.errorsTotal ?? 0);
  const endpoints = topEndpoints([...(m?.byEndpoint ?? [])], 6);
  const maxReq = Math.max(...endpoints.map((e) => e.requests), 1);

  const page1 = (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span>🌐</span>
        <strong className="flex-1 truncate">{props.name}</strong>
        <ApiStatusBadge requests={s?.requestsTotal ?? 0} errors={s?.errorsTotal ?? 0} />
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
  return (
    <Deck
      onOpen={() => props.onOpen(props.tag)}
      style={vt}
      pages={[page1, page2]}
      overlay={<DegradedOverlay tag={props.tag} />}
    />
  );
};

/** Stat cards from an API resource's snapshot + latest window. */
export const ApiStats = (props: { readonly bundle: ApiBundle }): React.ReactElement => {
  const statusR = useAtomValue(props.bundle.status);
  const metricsR = useAtomValue(props.bundle.metrics);
  const s = AsyncResult.isSuccess(statusR) ? statusR.value : undefined;
  const m = AsyncResult.isSuccess(metricsR) ? Option.getOrUndefined(metricsR.value) : undefined;
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
 *  accumulated metrics history. */
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
 *  distinctive API widget. */
export const ApiEndpointTable = (props: { readonly bundle: ApiBundle }): React.ReactElement => {
  const r = useAtomValue(props.bundle.metrics);
  const m = AsyncResult.isSuccess(r) ? Option.getOrUndefined(r.value) : undefined;
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

// ── Node widgets ─────────────────────────────────────────────────────────────
// Nodes are read straight off the tags (`nodesOf`): a dot per node the group's resources are bound
// to. Each dot's colour + popover come from that node's `NodeStatus` (over its own transport).

/** A node's overall colour: grey while connecting, red down, amber degraded, green ok. */
const nodeColor = (s: NodeStatusValue | undefined): string =>
  s === undefined ? "#64748b" : !s.up ? "#ef4444" : s.status === "degraded" ? "#eab308" : "#22c55e";

/** ~3× the 2s `NodeStatus` heartbeat: no fresh status in this long → the node's stream is dead and
 *  the shown values are frozen (last-known, not live). */
const STALE_MS = 6000;

/** True once a node's heartbeat has stopped. `NodeStatus.changes` re-emits every ~2s, so `beat` (its
 *  `uptimeMillis`) advances each tick; when it stops advancing the age climbs past {@link STALE_MS}
 *  and a frozen card can say so instead of looking live. Only a **genuine new heartbeat** (an advanced
 *  `uptimeMillis`) refreshes the timer — the drop-to-`undefined` + reconnect-retry churn a dying
 *  stream emits is ignored, so that churn can't masquerade as liveness. A 1s timer re-checks the age
 *  even when nothing new arrives. */
const useStale = (beat: number | undefined): boolean => {
  const last = React.useRef({ beat, at: now() });
  React.useEffect(() => {
    if (beat !== undefined && beat !== last.current.beat) {
      last.current = { beat, at: now() };
    }
  }, [beat]);
  const [, retick] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    const id = setInterval(retick, 1000);
    return () => clearInterval(id);
  }, []);
  return now() - last.current.at > STALE_MS;
};

/** Format an uptime span (ms) compactly. */
const fmtUptime = (ms: number): string => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
};

/** One node indicator dot + tap-for-info popover (tap again, or "view node", for the full screen). */
/** Compact "barrel stack" pip layout: dots in bottom-heavy, centered rows (≤3 rows) — upper rows
 *  nestle over the gaps below, so 3 → 1 over 2, 4 → 2-on-2, etc. Dots are sized **larger when there
 *  are fewer** nodes; beyond 9 the rows just keep widening. */
const pipLayout = (
  n: number,
): {
  readonly dot: string;
  readonly gap: string;
  readonly rows: ReadonlyArray<number>;
} => {
  const size =
    n <= 2
      ? { dot: "0.625rem", gap: "0.3125rem" }
      : n <= 4
        ? { dot: "0.5rem", gap: "0.25rem" }
        : n <= 9
          ? { dot: "0.375rem", gap: "0.21875rem" }
          : { dot: "0.3125rem", gap: "0.1875rem" };
  let rows: ReadonlyArray<number>;
  if (n <= 2) {
    rows = [n];
  } else if (n <= 6) {
    // two rows, bottom-heavy: 3 → [1,2], 4 → [2,2], 5 → [2,3], 6 → [3,3]
    const bottom = Math.ceil(n / 2);
    rows = [n - bottom, bottom];
  } else if (n === 7) {
    rows = [2, 3, 2]; // widest row in the middle (hex bulge)
  } else if (n === 8) {
    rows = [3, 2, 3]; // narrow row in the middle
  } else if (n === 9) {
    rows = [3, 3, 3];
  } else {
    // 10+: three rows, bottom-heavy, just keep widening
    const r3 = Math.ceil(n / 3);
    const r2 = Math.ceil((n - r3) / 2);
    rows = [n - r3 - r2, r2, r3];
  }
  return { ...size, rows };
};

/** Slice items into the layout's bottom-heavy rows (top → bottom). */
const pipRows = <A,>(items: ReadonlyArray<A>, rows: ReadonlyArray<number>): ReadonlyArray<ReadonlyArray<A>> => {
  let cursor = 0;
  return rows.map((count) => {
    const slice = items.slice(cursor, cursor + count);
    cursor += count;
    return slice;
  });
};

/** One node's pip — a coloured dot, colour from its NodeStatus. */
const NodePip = (props: {
  readonly node: NodeRef;
  readonly size: string;
}): React.ReactElement => {
  const r = useAtomValue(useNodeBundle(props.node).status);
  const s = AsyncResult.isSuccess(r) ? r.value : undefined;
  const stale = useStale(s?.uptimeMillis);
  React.useEffect(() => {
    if (AsyncResult.isFailure(r)) dlog("node", props.node.id, "FAILURE", Cause.pretty(r.cause));
    else dlog("node", props.node.id, asyncTag(r));
  }, [r, props.node.id]);
  // stale → a pulsing grey pip, so a lost node reads as "not responding" instead of its frozen colour.
  return (
    <span
      className={cn("rounded-full", stale && "animate-pulse")}
      style={{ width: props.size, height: props.size, backgroundColor: stale ? "#64748b" : nodeColor(s) }}
    />
  );
};

/** Static preview of the node die at a given count — the barrel-stack pip pattern only (no live
 *  status), for examples/docs that want to show the 1..9 shapes. */
export const NodeDots = (props: { readonly count: number }): React.ReactElement => {
  const layout = pipLayout(props.count);
  const rows = pipRows(
    Array.from({ length: props.count }, (_, i) => i),
    layout.rows,
  );
  return (
    <div className="flex flex-col items-center" style={{ gap: layout.gap }}>
      {rows.map((row, ri) => (
        <div key={ri} className="flex" style={{ gap: layout.gap }}>
          {row.map((i) => (
            <span
              key={i}
              className="rounded-full bg-foreground"
              style={{ width: layout.dot, height: layout.dot }}
            />
          ))}
        </div>
      ))}
    </div>
  );
};

/** A labelled summary number for the health board's top stat strip. */
const HealthStat = (props: {
  readonly label: string;
  readonly value: string;
  readonly tone?: string;
}): React.ReactElement => (
  <div className="rounded-md border bg-card px-2 py-1.5">
    <div className="text-sm font-semibold" style={props.tone !== undefined ? { color: props.tone } : undefined}>
      {props.value}
    </div>
    <div className="text-[0.65rem] leading-tight text-muted-foreground">{props.label}</div>
  </div>
);

/** One resource's readiness row — pip (green ready / amber degraded) + name + (kind or node) + the
 *  root-cause detail when degraded. Tap to open that resource's detail page. */
const ResourceReadinessRow = (props: {
  readonly res: NodeStatusValue["resources"][number];
  readonly node: NodeRef;
  /** Show the node id on the right (cross-node "needs attention" list) instead of the kind. */
  readonly showNode?: boolean;
  readonly onOpen: () => void;
}): React.ReactElement => {
  const { res } = props;
  const kindShort = res.kind.includes("/") ? (res.kind.split("/").pop() ?? res.kind) : res.kind;
  return (
    <li>
      <button
        type="button"
        onClick={props.onOpen}
        className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
      >
        <span
          className="mt-1 h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: res.ready ? "#22c55e" : "#eab308" }}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate font-medium">{displayName(res.key.split("/").pop() ?? res.key)}</span>
            <span className="shrink-0 text-[0.7rem] text-muted-foreground">
              {props.showNode === true ? displayName(props.node.id) : kindShort}
            </span>
          </span>
          {!res.ready && res.detail !== undefined ? (
            <span className="mt-0.5 block truncate text-[0.7rem] leading-tight text-amber-600">
              └ {res.detail}
            </span>
          ) : null}
        </span>
        <span className="shrink-0 self-center text-muted-foreground">›</span>
      </button>
    </li>
  );
};

/** One node's card on the health board — status dot + name + stats (uptime · ready/total · resource
 *  count), then its full resource roster (each tappable). Tap the header for the node's full screen.
 *  Pure: the status value is read once by {@link HealthBoard} and passed in. */
const NodeHealthCard = (props: {
  readonly node: NodeRef;
  readonly s: NodeStatusValue | undefined;
  readonly history: ReadonlyArray<number>;
  readonly onOpen: () => void;
  readonly onOpenResource: (resourceKey: string) => void;
}): React.ReactElement => {
  const s = props.s;
  const ready = s !== undefined ? s.resources.filter((x) => x.ready).length : 0;
  const total = s !== undefined ? s.resources.length : 0;
  return (
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        onClick={props.onOpen}
        className="flex w-full items-center gap-2.5 rounded-t-lg px-2 py-2 text-left hover:bg-muted"
      >
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: nodeColor(s) }} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{displayName(props.node.id)}</span>
          <span className="mt-0.5 block text-[0.7rem] leading-tight text-muted-foreground">
            {s !== undefined
              ? `${s.up ? s.status : "down"} · up ${fmtUptime(s.uptimeMillis)} · ${ready}/${total} ready · ${s.resourceCount} resource${s.resourceCount === 1 ? "" : "s"}`
              : "connecting…"}
          </span>
        </span>
        <span className="shrink-0 text-muted-foreground">›</span>
      </button>
      {props.history.length >= 2 ? (
        <div className="border-t px-2 pb-1 pt-1">
          <div className="mb-0.5 flex items-baseline justify-between text-[0.65rem] text-muted-foreground">
            <span>ready over time</span>
            <span>
              {ready}/{total}
            </span>
          </div>
          <Sparkline points={props.history} color={nodeColor(s)} />
        </div>
      ) : null}
      {s !== undefined && s.resources.length > 0 ? (
        <ul className="space-y-0.5 border-t px-1 py-1">
          {s.resources.map((res) => (
            <ResourceReadinessRow
              key={res.key}
              res={res}
              node={props.node}
              onOpen={() => props.onOpenResource(res.key)}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
};

/** The single node-status **die** button (top-right): one pip per node, coloured by its status — a die
 *  face for 1–9 nodes, then 3 rows + more columns. Tap to open the **health board** (full screen).
 *  Renders nothing for a nodeless (local) group. */
export const NodeBar = (props: {
  readonly group: GroupNode;
  readonly onOpen: () => void;
}): React.ReactElement | null => {
  const nodes = nodesOf(props.group);
  const ids = nodes.map((h) => h.id).join(", ");
  React.useEffect(() => {
    dlog("nodeBar: nodes =", nodes.length, ids === "" ? "(none)" : ids);
  }, [nodes.length, ids]);
  if (nodes.length === 0) return null;
  const layout = pipLayout(nodes.length);
  const rowGroups = pipRows(nodes, layout.rows);
  return (
    <button
      type="button"
      aria-label={`${nodes.length} node${nodes.length === 1 ? "" : "s"} — open health board`}
      onClick={props.onOpen}
      className="block shrink-0 p-1 transition-transform active:scale-95"
    >
      <div className="flex flex-col items-center" style={{ gap: layout.gap }}>
        {rowGroups.map((row, ri) => (
          <div key={ri} className="flex" style={{ gap: layout.gap }}>
            {row.map((h) => (
              <NodePip key={h.id} node={h} size={layout.dot} />
            ))}
          </div>
        ))}
      </div>
    </button>
  );
};

/** The full-screen **health board** (opened from the die): a top stat strip, then degraded resources
 *  across **every** node first (with their root-cause detail — tap → that resource's detail), then a
 *  card per node (status · uptime · ready/total · resource count, tap → its full screen) with its full
 *  resource roster. Reads each node's `NodeStatus` once (the node list is stable for a group, so the
 *  per-node reads keep a constant hook order; bundles are cached per runtime+node). */
export const HealthBoard = (props: {
  readonly group: GroupNode;
  readonly onBack: () => void;
  readonly onOpenNode: (node: NodeRef) => void;
  readonly onOpenResource: (resourceKey: string) => void;
}): React.ReactElement => {
  const nodes = nodesOf(props.group);
  // Each node's live status is read by its own `NodeHealthRow` child (hooks at the child's top level —
  // not in a `.map` over the node list, which the Rules of Hooks forbid and which would break if a
  // group ever gained/lost a node). The children report their status up so this board can compute the
  // cross-node aggregates (ready/total, degraded resources, degraded nodes). Statuses arrive async
  // (the underlying atoms start "connecting"), so this reporting adds no flash the direct reads didn't.
  const [statusMap, setStatusMap] = React.useState<
    ReadonlyMap<string, NodeStatusValue | undefined>
  >(() => new Map());
  const reportStatus = React.useCallback(
    (id: string, s: NodeStatusValue | undefined): void => {
      setStatusMap((prev) => {
        const next = new Map(prev);
        next.set(id, s);
        return next;
      });
    },
    [],
  );
  const statuses = nodes.map((node) => ({ node, s: statusMap.get(node.id) }));
  const degraded = statuses.flatMap(({ node, s }) =>
    (s?.resources ?? []).filter((x) => !x.ready).map((res) => ({ node, res })),
  );
  const total = statuses.reduce((n, { s }) => n + (s?.resources.length ?? 0), 0);
  const ready = statuses.reduce((n, { s }) => n + (s?.resources.filter((x) => x.ready).length ?? 0), 0);
  const degradedNodes = statuses.filter(({ s }) => s !== undefined && (!s.up || s.status === "degraded")).length;
  const healthy = degradedNodes === 0;
  return (
    <div className="flex h-[100dvh] flex-col gap-3 overflow-y-auto safe-area landscape:h-auto landscape:min-h-[100dvh]">
      <header className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={props.onBack}>
          ← back
        </Button>
        <strong className="flex-1 truncate text-base">⬢ Health</strong>
        <span className="text-sm font-medium" style={{ color: healthy ? "#22c55e" : "#eab308" }}>
          {healthy ? "all healthy" : `⚠ ${degradedNodes}/${nodes.length} degraded`}
        </span>
      </header>
      <div className="grid grid-cols-3 gap-2 text-center">
        <HealthStat label="nodes ok" value={`${nodes.length - degradedNodes}/${nodes.length}`} />
        <HealthStat label="resources ready" value={`${ready}/${total}`} />
        <HealthStat
          label="needs attention"
          value={`${degraded.length}`}
          tone={degraded.length > 0 ? "#eab308" : undefined}
        />
      </div>
      {degraded.length > 0 ? (
        <section>
          <h2 className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            needs attention · {degraded.length}
          </h2>
          <ul className="space-y-0.5">
            {degraded.map(({ node, res }) => (
              <ResourceReadinessRow
                key={`${node.id}:${res.key}`}
                res={res}
                node={node}
                showNode
                onOpen={() => props.onOpenResource(res.key)}
              />
            ))}
          </ul>
        </section>
      ) : null}
      <section>
        <h2 className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          nodes · {nodes.length}
        </h2>
        <div className="space-y-2">
          {nodes.map((node) => (
            <NodeHealthRow
              key={node.id}
              node={node}
              onStatus={reportStatus}
              onOpen={() => props.onOpenNode(node)}
              onOpenResource={props.onOpenResource}
            />
          ))}
        </div>
      </section>
    </div>
  );
};

/** One node's health card for {@link HealthBoard}. Calls the per-node status/health hooks at its own
 *  top level (Rules-of-Hooks safe) and reports the status up so the board can aggregate across nodes. */
const NodeHealthRow = (props: {
  readonly node: NodeRef;
  readonly onStatus: (id: string, s: NodeStatusValue | undefined) => void;
  readonly onOpen: () => void;
  readonly onOpenResource: (resourceKey: string) => void;
}): React.ReactElement => {
  const bundle = useNodeBundle(props.node);
  const r = useAtomValue(bundle.status);
  const h = useAtomValue(bundle.health);
  const s = AsyncResult.isSuccess(r) ? r.value : undefined;
  const history = AsyncResult.isSuccess(h) ? h.value : [];
  const { onStatus, node } = props;
  React.useEffect(() => {
    onStatus(node.id, s);
  }, [onStatus, node.id, s]);
  return (
    <NodeHealthCard
      node={node}
      s={s}
      history={history}
      onOpen={props.onOpen}
      onOpenResource={props.onOpenResource}
    />
  );
};

/** Reads one resource's readiness from its node's `NodeStatus` (the node computes it — SSOT). Always
 *  has a node (the public wrapper renders nothing for a nodeless tag). Shows **only when degraded** —
 *  nothing while ready/connecting, so the banner only takes space when there's a problem. */
const ReadinessBannerInner = (props: {
  readonly tag: unknown;
  readonly node: NodeRef;
}): React.ReactElement | null => {
  const r = useAtomValue(useNodeBundle(props.node).status);
  const s = AsyncResult.isSuccess(r) ? r.value : undefined;
  const key = tagWireKey(props.tag);
  const readiness = s?.resources.find((x) => x.key === key);
  if (readiness === undefined || readiness.ready) return null; // ready/connecting → no banner
  return (
    <div
      className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-[0.8rem]"
      style={{ borderColor: "#eab308", backgroundColor: "rgba(234,179,8,0.08)" }}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: "#eab308" }} />
      <span className="font-medium">degraded</span>
      {readiness.detail !== undefined ? (
        <span className="min-w-0 flex-1 truncate text-amber-600">— {readiness.detail}</span>
      ) : (
        <span className="flex-1" />
      )}
      <span className="shrink-0 text-muted-foreground">{displayName(props.node.id)}</span>
    </div>
  );
};

/** A resource's **degraded** banner for its detail page — an amber "degraded — &lt;root cause&gt;" line
 *  read from its node's `NodeStatus` (the same SSOT the health board uses). Renders nothing while the
 *  resource is ready/connecting or nodeless, so it only appears (pushing content down) on a problem. */
export const ResourceReadinessBanner = (props: { readonly tag: unknown }): React.ReactElement | null => {
  const node = resourceNodeRef(props.tag);
  if (node === undefined) return null;
  return <ReadinessBannerInner tag={props.tag} node={node} />;
};

/** Fullscreen node view: header + each served resource's readiness (tap → that resource's page).
 *  Graphs land with node metrics. */
export const NodeDetail = (props: {
  readonly node: NodeRef;
  readonly onBack: () => void;
  /** Open a served resource's detail page, by its wire key (`NodeStatus.resources[].key`). */
  readonly onOpenResource: (resourceKey: string) => void;
}): React.ReactElement => {
  const bundle = useNodeBundle(props.node);
  const r = useAtomValue(bundle.status);
  const s = AsyncResult.isSuccess(r) ? r.value : undefined;
  const color = nodeColor(s);
  return (
    <div className="flex h-[100dvh] flex-col gap-3 overflow-hidden safe-area landscape:h-auto landscape:min-h-[100dvh] landscape:overflow-visible">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={props.onBack}>
          ← back
        </Button>
        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
        <strong className="flex-1 truncate text-base">{displayName(props.node.id)}</strong>
        <span className="text-sm text-muted-foreground">{s !== undefined ? (s.up ? s.status : "down") : "…"}</span>
      </div>
      {s !== undefined ? (
        <>
          <div className="flex gap-3">
            <Stat label="uptime" value={fmtUptime(s.uptimeMillis)} />
            <Stat label="resources" value={String(s.resourceCount)} />
            <Stat label="status" value={s.status} />
          </div>
          <div className="max-h-[38dvh] shrink-0 overflow-auto rounded-xl border bg-card p-3">
            <div className="mb-2 text-sm font-semibold">resources</div>
            <ul className="space-y-1">
              {s.resources.map((res) => (
                <li key={res.key}>
                  <button
                    type="button"
                    onClick={() => props.onOpenResource(res.key)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: res.ready ? "#22c55e" : "#eab308" }}
                    />
                    <span className="flex-1 truncate">{displayName(res.key)}</span>
                    <Badge>{displayName(res.kind)}</Badge>
                    <span className="text-muted-foreground">
                      {res.ready ? "ready" : (res.detail ?? "not ready")}
                    </span>
                    <span className="shrink-0 text-muted-foreground">›</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card">
            <div className="shrink-0 border-b px-3 py-2 text-sm font-semibold">logs</div>
            <LogStream bundle={{ logs: bundle.logs }} className="flex-1 py-1" />
          </div>
          {/* Pass 2: node metrics graphs (CPU / mem / throughput) land here with NodeStatus.metrics. */}
        </>
      ) : (
        <div className="text-muted-foreground">connecting to node…</div>
      )}
    </div>
  );
};

// ============================================================================
// Widget registry — the built-in set
// ============================================================================

/** A resource's readiness as a small "badge dot": a border-only **green** circle when ready, a filled
 *  **amber** one when not — the UI's ready/degraded colours (`#22c55e` / `#eab308`, as the readiness
 *  pips). Reads its node's `NodeStatus` — the SSOT the overlay uses. */
const ReadinessDotInner = (props: {
  readonly tag: unknown;
  readonly node: NodeRef;
}): React.ReactElement => {
  const r = useAtomValue(useNodeBundle(props.node).status);
  const s = AsyncResult.isSuccess(r) ? r.value : undefined;
  const readiness = s?.resources.find((x) => x.key === tagWireKey(props.tag));
  const ready = readiness === undefined || readiness.ready; // loading/unknown → ready (empty)
  return (
    <span
      className="size-3.5 shrink-0 rounded-full border"
      style={ready ? { borderColor: "#22c55e" } : { borderColor: "#eab308", backgroundColor: "#eab308" }}
      aria-label={ready ? "ready" : "degraded"}
      title={ready ? "ready" : (readiness?.detail ?? "degraded")}
    />
  );
};

/** The plain-resource readiness dot — an empty badge when ready, filled when degraded. Nothing for a
 *  nodeless tag (no node computes its readiness). @public */
export const ReadinessDot = (props: { readonly tag: unknown }): React.ReactElement | null => {
  const node = resourceNodeRef(props.tag);
  if (node === undefined) return null;
  return <ReadinessDotInner tag={props.tag} node={node} />;
};

/**
 * Basic fallback card — a resource whose kind has no registered widget (a bare `…/Hyperlink`, or an
 * unregistered kind). Shows the resource's name, its kind, and a degraded banner; a richer card is
 * left to a dedicated widget registered for that kind. @public
 */
export const FallbackCard = (props: WidgetProps): React.ReactElement => (
  <Card>
    <CardContent className="p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium text-foreground">{props.name}</span>
        {/* no operational status ref → the readiness dot fills the status slot (same as ResourceCard) */}
        <ReadinessDot tag={props.tag} />
      </div>
      <ResourceReadinessBanner tag={props.tag} />
    </CardContent>
  </Card>
);

/**
 * The card for a plain resource — a bare `Hyperlink.Tag` with no richer widget (a dependency like a
 * DB connection, a health gate). There's little beyond identity to show, so it's the readiness LED
 * (its degraded reason on hover, like every card) + name + kind + the node it runs on. @public
 */
export const ResourceCard = (props: WidgetProps): React.ReactElement => {
  const node = resourceNodeRef(props.tag);
  return (
    <Card className="relative">
      <CardContent className="p-3">
        <div className="flex items-center gap-2">
          <span className="flex-1 truncate font-medium text-foreground">{props.name}</span>
          <ReadinessDot tag={props.tag} />
        </div>
        {node !== undefined ? (
          <div className="mt-2 text-[0.8rem] text-muted-foreground">{displayName(node.id)}</div>
        ) : null}
      </CardContent>
      <DegradedOverlay tag={props.tag} />
    </Card>
  );
};

// Each built-in adapts a typed card to the registry's LeafTag props. Registered under its kind, so
// the matching guard recovers the tag's type at render — runtime-discriminated, cast-free.
/** One node's row in a fleet-health card: a coloured pip (reachable ok/degraded, or unreachable) +
 *  the node name + its state. */
/** Shared class for a drillable read-only card — a `<button>` root that opens the fullscreen detail. */
const DRILL_CARD = "relative flex flex-col rounded-xl border bg-card p-3 text-left transition-colors hover:border-ring focus-visible:border-ring focus-visible:outline-none";

const FleetNodeRow = (props: { readonly node: string; readonly report: NodeReport }): React.ReactElement => {
  const color =
    props.report._tag === "Unreachable"
      ? "#ef4444"
      : props.report.status === "degraded"
        ? "#eab308"
        : "#22c55e";
  const label = props.report._tag === "Unreachable" ? "unreachable" : props.report.status;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{displayName(props.node)}</span>
      <span className="shrink-0" style={{ color }}>{label}</span>
    </div>
  );
};

/** Fleet-status rollup colours — ok / degraded / partial (any node unreachable). */
const FLEET_STATUS: Record<string, string> = { ok: "#22c55e", degraded: "#eab308", partial: "#ef4444" };

/**
 * The card for a **FleetHealth** resource — surfaces its two `fleet` fields: the `status` rollup
 * (ok / degraded / partial) as the header badge, and the `byNode` map as a pip-per-node roster
 * (Reachable ok/degraded, or Unreachable when a peer is down). Read-only. @public
 */
export const FleetHealthCard = (props: {
  readonly tag: FleetHealthTag;
  /** Display name — the member key under which the parent group holds this tag. */
  readonly name: string;
  readonly onOpen: (tag: FleetHealthTag) => void;
}): React.ReactElement => {
  const vt = useViewTransitionStyle(`res-${props.tag.key}`);
  const bundle = useFleetHealthBundle(props.tag);
  const statusR = useAtomValue(bundle.status);
  const byNodeR = useAtomValue(bundle.byNode);
  const status = AsyncResult.isSuccess(statusR) ? statusR.value : undefined;
  const byNode = AsyncResult.isSuccess(byNodeR) ? byNodeR.value : {};
  const rows = Object.entries(byNode).sort(([a], [b]) => a.localeCompare(b));
  return (
    <button type="button" onClick={() => props.onOpen(props.tag)} className={DRILL_CARD} style={vt}>
      <div className="mb-2 flex items-center gap-2">
        <strong className="flex-1 truncate">{props.name}</strong>
        <Badge color={FLEET_STATUS[status ?? "ok"] ?? "#94a3b8"}>{status ?? "…"}</Badge>
      </div>
      <div className="flex flex-col gap-1">
        {rows.length === 0 ? (
          <div className="text-xs text-muted-foreground">connecting…</div>
        ) : (
          rows.map(([node, report]) => <FleetNodeRow key={node} node={node} report={report} />)
        )}
      </div>
      <DegradedOverlay tag={props.tag} />
    </button>
  );
};

/** One node's count as a labelled bar — the per-node breakdown for the telemetry + shard-map cards. */
const NodeCountRow = (props: {
  readonly node: string;
  readonly count: number;
  readonly max: number;
}): React.ReactElement => (
  <div className="flex items-center gap-2 text-xs">
    <span className="w-16 shrink-0 truncate text-muted-foreground">{displayName(props.node)}</span>
    <Bar value={props.count} max={props.max} color="#3b82f6" />
    <span className="w-6 shrink-0 text-right tabular-nums text-foreground">{props.count}</span>
  </div>
);

/**
 * The card for a **Telemetry** resource — surfaces its fleet folds: `fleetInFlight` (in-flight across
 * the whole fleet) as the headline number, `inFlightByNode` as a bar-per-node breakdown, plus this
 * node's live metric count (from `snapshot`). Read-only. @public
 */
export const TelemetryCard = (props: {
  readonly tag: TelemetryTag;
  /** Display name — the member key under which the parent group holds this tag. */
  readonly name: string;
  readonly onOpen: (tag: TelemetryTag) => void;
}): React.ReactElement => {
  const vt = useViewTransitionStyle(`res-${props.tag.key}`);
  const bundle = useTelemetryBundle(props.tag);
  const fleetR = useAtomValue(bundle.fleetInFlight);
  const byNodeR = useAtomValue(bundle.inFlightByNode);
  const countR = useAtomValue(bundle.metricCount);
  const fleet = AsyncResult.isSuccess(fleetR) ? fleetR.value : 0;
  const byNode = AsyncResult.isSuccess(byNodeR) ? byNodeR.value : {};
  const count = AsyncResult.isSuccess(countR) ? countR.value : undefined;
  const rows = Object.entries(byNode).sort(([a], [b]) => a.localeCompare(b));
  const max = Math.max(1, ...rows.map(([, n]) => n));
  return (
    <button type="button" onClick={() => props.onOpen(props.tag)} className={DRILL_CARD} style={vt}>
      <div className="mb-2 flex items-center gap-2">
        <strong className="flex-1 truncate">{props.name}</strong>
        {count !== undefined ? (
          <span className="shrink-0 rounded-full border px-2 py-0.5 text-[0.7rem] text-muted-foreground">
            {count} metrics
          </span>
        ) : null}
      </div>
      <div className="mb-3 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tabular-nums text-foreground">{fleet}</span>
        <span className="text-xs text-muted-foreground">in-flight · fleet total</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {rows.map(([node, n]) => <NodeCountRow key={node} node={node} count={n} max={max} />)}
      </div>
      <DegradedOverlay tag={props.tag} />
    </button>
  );
};

/**
 * The card for a **ShardMap** resource — a partitioned key/value mesh. Surfaces its fleet folds:
 * `size` (entries across the whole fleet) as the headline, `sizeByNode` as a bar-per-node breakdown,
 * plus this node's own shard (`sizeLocal`) as a footnote. Read-only. @public
 */
export const ShardMapCard = (props: {
  readonly tag: ShardMapTag;
  /** Display name — the member key under which the parent group holds this tag. */
  readonly name: string;
  readonly onOpen: (tag: ShardMapTag) => void;
}): React.ReactElement => {
  const vt = useViewTransitionStyle(`res-${props.tag.key}`);
  const bundle = useShardMapBundle(props.tag);
  const sizeR = useAtomValue(bundle.size);
  const byNodeR = useAtomValue(bundle.sizeByNode);
  const localR = useAtomValue(bundle.sizeLocal);
  const size = AsyncResult.isSuccess(sizeR) ? sizeR.value : 0;
  const byNode = AsyncResult.isSuccess(byNodeR) ? byNodeR.value : {};
  const local = AsyncResult.isSuccess(localR) ? localR.value : undefined;
  const rows = Object.entries(byNode).sort(([a], [b]) => a.localeCompare(b));
  const max = Math.max(1, ...rows.map(([, n]) => n));
  return (
    <button type="button" onClick={() => props.onOpen(props.tag)} className={DRILL_CARD} style={vt}>
      <div className="mb-2 flex items-center gap-2">
        <strong className="flex-1 truncate">{props.name}</strong>
        <span className="shrink-0 rounded-full border px-2 py-0.5 text-[0.7rem] text-muted-foreground">
          {rows.length} shard{rows.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="mb-3 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tabular-nums text-foreground">{size}</span>
        <span className="text-xs text-muted-foreground">entries · fleet total</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {rows.map(([node, n]) => <NodeCountRow key={node} node={node} count={n} max={max} />)}
      </div>
      {local !== undefined ? (
        <div className="mt-2 text-[0.7rem] text-muted-foreground">this node holds {local}</div>
      ) : null}
      <DegradedOverlay tag={props.tag} />
    </button>
  );
};

/** One labelled counter for the run-gate card's outcome row. */
const RunCounter = (props: {
  readonly label: string;
  readonly value: number;
  readonly color: string;
}): React.ReactElement => (
  <div className="flex flex-col gap-0.5">
    <span className="tabular-nums text-sm font-semibold" style={{ color: props.color }}>{props.value}</span>
    <span className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">{props.label}</span>
  </div>
);

/**
 * The card for a **RunResource** (concurrency gate) — surfaces its live counters: `inFlight` /
 * `concurrency` as a utilization gauge headline (plus `waiting` backlog), the completed / failed /
 * interrupted outcome tallies, and the mean run duration. Read-only. @public
 */
export const RunResourceCard = (props: {
  readonly tag: RunTag;
  /** Display name — the member key under which the parent group holds this tag. */
  readonly name: string;
  readonly onOpen: (tag: RunTag) => void;
}): React.ReactElement => {
  const vt = useViewTransitionStyle(`res-${props.tag.key}`);
  const bundle = useRunBundle(props.tag);
  const statusR = useAtomValue(bundle.status);
  const s = AsyncResult.isSuccess(statusR) ? statusR.value : undefined;
  const concurrency = s !== undefined ? s.concurrency : 0;
  const inFlight = s !== undefined ? s.inFlight : 0;
  const waiting = s !== undefined ? s.waiting : 0;
  const completed = s !== undefined ? s.completed : 0;
  const failed = s !== undefined ? s.failed : 0;
  const interrupted = s !== undefined ? s.interrupted : 0;
  const avgMs = completed > 0 && s !== undefined ? Math.round(s.totalDurationMs / completed) : undefined;
  return (
    <button type="button" onClick={() => props.onOpen(props.tag)} className={DRILL_CARD} style={vt}>
      <div className="mb-2 flex items-center gap-2">
        <strong className="flex-1 truncate">{props.name}</strong>
        <span className="shrink-0 rounded-full border px-2 py-0.5 text-[0.7rem] text-muted-foreground">
          limit {concurrency}
        </span>
      </div>
      <div className="mb-1.5 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tabular-nums text-foreground">{inFlight}</span>
        <span className="text-xs text-muted-foreground">in-flight · {waiting} waiting</span>
      </div>
      <div className="mb-3">
        <Bar value={inFlight} max={Math.max(1, concurrency)} color="#3b82f6" />
      </div>
      <div className="flex items-center gap-6">
        <RunCounter label="done" value={completed} color="#22c55e" />
        <RunCounter label="failed" value={failed} color="#ef4444" />
        <RunCounter label="interrupted" value={interrupted} color="#a1a1aa" />
        {avgMs !== undefined ? (
          <div className="ml-auto text-[0.7rem] text-muted-foreground">avg {avgMs}ms</div>
        ) : null}
      </div>
      <DegradedOverlay tag={props.tag} />
    </button>
  );
};

// ── Fullscreen detail pages for the newer kinds ──────────────────────────────
// Each is a DetailScreen fed an ordered list of `sections`; the Deck auto-packs them into pages by
// measuring against the viewport. Live/hook-heavy blocks (charts, logs, long lists) are marked
// `grow` so they stretch to fill and are measured as a spacer, not double-mounted.

/**
 * Fullscreen detail for a **custom queue** — stats, lanes, controls, the throughput chart, and the
 * live log stream, auto-paginated. Fills the drill-in that the grid `CustomQueueCard` opens. @public
 */
export const CustomQueueDetail = (props: {
  readonly tag: CustomQueueTag;
  readonly name?: string;
  readonly onBack: () => void;
}): React.ReactElement => {
  const bundle = useCustomQueueBundle(props.tag);
  const statusR = useAtomValue(bundle.status);
  const s = AsyncResult.isSuccess(statusR) ? Option.getOrUndefined(statusR.value) : undefined;
  const paused = s?.paused === true;
  const lanes = s !== undefined ? Object.entries(s.sizes) : [];
  const pending = lanes.reduce((sum, [, n]) => sum + n, 0);
  const max = Math.max(1, ...lanes.map(([, n]) => n));
  const [locked, setLocked] = React.useState(true);
  const sections: ReadonlyArray<DeckSection> = [
    {
      key: "stats",
      content: (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="pending" value={String(pending)} />
          <Stat label="done" value={String(s?.completed ?? 0)} />
          <Stat label="lanes" value={String(lanes.length)} />
          <Stat label="phase" value={paused ? "paused" : s?.phase ?? "running"} />
        </div>
      ),
    },
    {
      key: "lanes",
      content: (
        <div className="rounded-xl border bg-card p-3">
          <div className="mb-2 text-xs font-semibold text-muted-foreground">lanes</div>
          <div className="flex flex-col gap-1.5">
            {lanes.length === 0 ? (
              <div className="text-xs text-muted-foreground">no lanes</div>
            ) : (
              lanes.map(([lane, count]) => <LaneRow key={lane} lane={lane} count={count} max={max} />)
            )}
          </div>
        </div>
      ),
    },
    {
      key: "controls",
      content: (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {paused ? (
            <ActionButton atom={bundle.resume} label="resume" icon={<Play className="size-4" />} disabled={locked} />
          ) : (
            <ActionButton atom={bundle.pause} label="pause" icon={<Pause className="size-4" />} disabled={locked} />
          )}
          <ActionButton atom={bundle.clear} label="clear" icon={<Trash2 className="size-4" />} disabled={locked} confirm />
          <ActionButton atom={bundle.shutdown} label="shutdown" icon={<Power className="size-4" />} disabled={locked} confirm destructive />
          <LockToggle locked={locked} onToggle={() => setLocked((l) => !l)} />
        </div>
      ),
    },
    {
      key: "chart",
      grow: true,
      minHeight: 190,
      content: <div className="flex h-full flex-col overflow-hidden rounded-xl border bg-card p-3"><MetricChart bundle={bundle} /></div>,
    },
    {
      key: "logs",
      grow: true,
      minHeight: 200,
      content: <LogStream bundle={bundle} className="h-full rounded-xl border bg-card" />,
    },
  ];
  return (
    <DetailScreen
      title={props.name ?? displayName(props.tag.key)}
      onBack={props.onBack}
      vtKey={`res-${props.tag.key}`}
      readinessTag={props.tag}
      badge={<Badge color={paused ? "#eab308" : CQ_PHASE[s?.phase ?? "running"] ?? "#22c55e"}>{paused ? "paused" : s?.phase ?? "running"}</Badge>}
      sections={sections}
    />
  );
};

/** One metric datum as a row — id + kind + its reading (count / gauge value / histogram count). */
const MetricRow = (props: { readonly datum: MetricDatum }): React.ReactElement => {
  const d = props.datum;
  const value = d._tag === "Gauge" ? d.value : d._tag === "Counter" ? d.count : d.count;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="min-w-0 flex-1 truncate text-foreground">{d.id}</span>
      <span className="shrink-0 rounded border px-1 text-[0.65rem] text-muted-foreground">{d._tag.toLowerCase()}</span>
      <span className="w-16 shrink-0 text-right tabular-nums text-muted-foreground">{value}</span>
    </div>
  );
};

/**
 * Fullscreen detail for a **Telemetry** mesh — page 1 the fleet in-flight total + per-node bars,
 * page 2 this node's full metric registry (id + kind + reading), which the card only counts. @public
 */
export const TelemetryDetail = (props: {
  readonly tag: TelemetryTag;
  readonly name?: string;
  readonly onBack: () => void;
}): React.ReactElement => {
  const bundle = useTelemetryBundle(props.tag);
  const fleetR = useAtomValue(bundle.fleetInFlight);
  const byNodeR = useAtomValue(bundle.inFlightByNode);
  const countR = useAtomValue(bundle.metricCount);
  const metricsR = useAtomValue(bundle.metrics);
  const fleet = AsyncResult.isSuccess(fleetR) ? fleetR.value : 0;
  const byNode = AsyncResult.isSuccess(byNodeR) ? byNodeR.value : {};
  const count = AsyncResult.isSuccess(countR) ? countR.value : undefined;
  const metrics = AsyncResult.isSuccess(metricsR) ? metricsR.value : [];
  const rows = Object.entries(byNode).sort(([a], [b]) => a.localeCompare(b));
  const max = Math.max(1, ...rows.map(([, n]) => n));
  const sorted = [...metrics].sort((a, b) => a.id.localeCompare(b.id));
  const sections: ReadonlyArray<DeckSection> = [
    {
      key: "overview",
      content: (
        <div className="rounded-xl border bg-card p-3">
          <div className="mb-2 flex items-baseline gap-1.5">
            <span className="text-3xl font-semibold tabular-nums text-foreground">{fleet}</span>
            <span className="text-xs text-muted-foreground">in-flight · fleet total</span>
          </div>
          <div className="flex flex-col gap-1.5">
            {rows.map(([node, n]) => <NodeCountRow key={node} node={node} count={n} max={max} />)}
          </div>
        </div>
      ),
    },
    {
      key: "metrics",
      grow: true,
      minHeight: 220,
      content: (
        <div className="flex h-full min-h-0 flex-col rounded-xl border bg-card p-3">
          <div className="mb-2 text-xs font-semibold text-muted-foreground">{sorted.length} metrics (this node)</div>
          <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
            {sorted.length === 0 ? (
              <div className="text-xs text-muted-foreground">no metrics</div>
            ) : (
              sorted.map((d) => <MetricRow key={`${d._tag}:${d.id}`} datum={d} />)
            )}
          </div>
        </div>
      ),
    },
  ];
  return (
    <DetailScreen
      title={props.name ?? displayName(props.tag.key)}
      onBack={props.onBack}
      vtKey={`res-${props.tag.key}`}
      badge={count !== undefined ? <Badge color="#94a3b8">{count} metrics</Badge> : undefined}
      sections={sections}
    />
  );
};

/**
 * Fullscreen detail for a **ShardMap** mesh — the entry count across the fleet, the per-node shard
 * sizes as bars, and this node's own shard. A single richer page (the card is a compact preview).
 * @public
 */
export const ShardMapDetail = (props: {
  readonly tag: ShardMapTag;
  readonly name?: string;
  readonly onBack: () => void;
}): React.ReactElement => {
  const bundle = useShardMapBundle(props.tag);
  const sizeR = useAtomValue(bundle.size);
  const byNodeR = useAtomValue(bundle.sizeByNode);
  const localR = useAtomValue(bundle.sizeLocal);
  const size = AsyncResult.isSuccess(sizeR) ? sizeR.value : 0;
  const byNode = AsyncResult.isSuccess(byNodeR) ? byNodeR.value : {};
  const local = AsyncResult.isSuccess(localR) ? localR.value : undefined;
  const rows = Object.entries(byNode).sort(([a], [b]) => a.localeCompare(b));
  const max = Math.max(1, ...rows.map(([, n]) => n));
  const sections: ReadonlyArray<DeckSection> = [
    {
      key: "shards",
      content: (
        <div className="rounded-xl border bg-card p-3">
          <div className="mb-2 flex items-baseline gap-1.5">
            <span className="text-3xl font-semibold tabular-nums text-foreground">{size}</span>
            <span className="text-xs text-muted-foreground">entries · fleet total</span>
          </div>
          <div className="mb-2 text-xs font-semibold text-muted-foreground">per shard</div>
          <div className="flex flex-col gap-1.5">
            {rows.map(([node, n]) => <NodeCountRow key={node} node={node} count={n} max={max} />)}
          </div>
          {local !== undefined ? (
            <div className="mt-3 text-xs text-muted-foreground">this node holds <strong className="text-foreground">{local}</strong></div>
          ) : null}
        </div>
      ),
    },
  ];
  return (
    <DetailScreen
      title={props.name ?? displayName(props.tag.key)}
      onBack={props.onBack}
      vtKey={`res-${props.tag.key}`}
      badge={<Badge color="#94a3b8">{rows.length} shard{rows.length === 1 ? "" : "s"}</Badge>}
      sections={sections}
    />
  );
};

/**
 * Fullscreen detail for a **FleetHealth** mesh — the status rollup and the full per-node roster
 * (each peer Reachable ok/degraded or Unreachable), roomier than the grid card. @public
 */
export const FleetHealthDetail = (props: {
  readonly tag: FleetHealthTag;
  readonly name?: string;
  readonly onBack: () => void;
}): React.ReactElement => {
  const bundle = useFleetHealthBundle(props.tag);
  const statusR = useAtomValue(bundle.status);
  const byNodeR = useAtomValue(bundle.byNode);
  const status = AsyncResult.isSuccess(statusR) ? statusR.value : undefined;
  const byNode = AsyncResult.isSuccess(byNodeR) ? byNodeR.value : {};
  const rows = Object.entries(byNode).sort(([a], [b]) => a.localeCompare(b));
  const sections: ReadonlyArray<DeckSection> = [
    {
      key: "roster",
      content: (
        <div className="rounded-xl border bg-card p-3">
          <div className="mb-2 text-xs font-semibold text-muted-foreground">{rows.length} nodes</div>
          <div className="flex flex-col gap-2">
            {rows.length === 0 ? (
              <div className="text-xs text-muted-foreground">connecting…</div>
            ) : (
              rows.map(([node, report]) => <FleetNodeRow key={node} node={node} report={report} />)
            )}
          </div>
        </div>
      ),
    },
  ];
  return (
    <DetailScreen
      title={props.name ?? displayName(props.tag.key)}
      onBack={props.onBack}
      vtKey={`res-${props.tag.key}`}
      badge={<Badge color={FLEET_STATUS[status ?? "ok"] ?? "#94a3b8"}>{status ?? "…"}</Badge>}
      sections={sections}
    />
  );
};

/**
 * Fullscreen detail for a **RunResource** gate — the in-flight gauge + outcome tallies of the card,
 * plus the raw status fields the card omits (concurrency, mean + total duration, config version).
 * @public
 */
export const RunResourceDetail = (props: {
  readonly tag: RunTag;
  readonly name?: string;
  readonly onBack: () => void;
}): React.ReactElement => {
  const bundle = useRunBundle(props.tag);
  const statusR = useAtomValue(bundle.status);
  const s = AsyncResult.isSuccess(statusR) ? statusR.value : undefined;
  const concurrency = s?.concurrency ?? 0;
  const inFlight = s?.inFlight ?? 0;
  const completed = s?.completed ?? 0;
  const avgMs = completed > 0 && s !== undefined ? Math.round(s.totalDurationMs / completed) : 0;
  const sections: ReadonlyArray<DeckSection> = [
    {
      key: "gauge",
      content: (
        <div className="rounded-xl border bg-card p-3">
          <div className="mb-1.5 flex items-baseline gap-1.5">
            <span className="text-3xl font-semibold tabular-nums text-foreground">{inFlight}</span>
            <span className="text-xs text-muted-foreground">in-flight · {s?.waiting ?? 0} waiting · limit {concurrency}</span>
          </div>
          <Bar value={inFlight} max={Math.max(1, concurrency)} color="#3b82f6" />
        </div>
      ),
    },
    {
      key: "outcomes",
      content: (
        <div className="grid grid-cols-3 gap-3">
          <Stat label="done" value={String(completed)} />
          <Stat label="failed" value={String(s?.failed ?? 0)} />
          <Stat label="interrupted" value={String(s?.interrupted ?? 0)} />
        </div>
      ),
    },
    {
      key: "timings",
      content: (
        <div className="grid grid-cols-3 gap-3">
          <Stat label="avg run" value={`${avgMs}ms`} />
          <Stat label="total time" value={`${Math.round((s?.totalDurationMs ?? 0) / 1000)}s`} />
          <Stat label="config v" value={String(s?.configVersion ?? 0)} />
        </div>
      ),
    },
  ];
  return (
    <DetailScreen
      title={props.name ?? displayName(props.tag.key)}
      onBack={props.onBack}
      vtKey={`res-${props.tag.key}`}
      readinessTag={props.tag}
      badge={<Badge color="#94a3b8">limit {concurrency}</Badge>}
      sections={sections}
    />
  );
};

const queueWidget: Widget = ({ tag, name, onOpen }) =>
  isQueueTag(tag) ? (
    <QueueCard tag={tag} name={name} onOpen={onOpen} />
  ) : (
    <FallbackCard tag={tag} name={name} onOpen={onOpen} />
  );
const processWidget: Widget = ({ tag, name, onOpen }) =>
  isProcessTag(tag) ? (
    <ProcessCard tag={tag} name={name} onOpen={onOpen} />
  ) : (
    <FallbackCard tag={tag} name={name} onOpen={onOpen} />
  );
const apiWidget: Widget = ({ tag, name, onOpen }) =>
  isApiTag(tag) ? (
    <ApiCard tag={tag} name={name} onOpen={onOpen} />
  ) : (
    <FallbackCard tag={tag} name={name} onOpen={onOpen} />
  );
const customQueueWidget: Widget = ({ tag, name, onOpen }) =>
  isCustomQueueTag(tag) ? (
    <CustomQueueCard tag={tag} name={name} onOpen={onOpen} />
  ) : (
    <FallbackCard tag={tag} name={name} onOpen={onOpen} />
  );
const fleetHealthWidget: Widget = ({ tag, name, onOpen }) =>
  isFleetHealthTag(tag) ? (
    <FleetHealthCard tag={tag} name={name} onOpen={onOpen} />
  ) : (
    <FallbackCard tag={tag} name={name} onOpen={onOpen} />
  );
const telemetryWidget: Widget = ({ tag, name, onOpen }) =>
  isTelemetryTag(tag) ? (
    <TelemetryCard tag={tag} name={name} onOpen={onOpen} />
  ) : (
    <FallbackCard tag={tag} name={name} onOpen={onOpen} />
  );
const shardMapWidget: Widget = ({ tag, name, onOpen }) =>
  isShardMapTag(tag) ? (
    <ShardMapCard tag={tag} name={name} onOpen={onOpen} />
  ) : (
    <FallbackCard tag={tag} name={name} onOpen={onOpen} />
  );
const runWidget: Widget = ({ tag, name, onOpen }) =>
  isRunTag(tag) ? (
    <RunResourceCard tag={tag} name={name} onOpen={onOpen} />
  ) : (
    <FallbackCard tag={tag} name={name} onOpen={onOpen} />
  );

/**
 * The built-in widget set: queue / process / API cards by kind, with {@link FallbackCard} for
 * everything else. The default for `<Dashboard>`; extend or override it with
 * `withEntries(base, [forKind(...), forKey(...)])`. @public
 */
export const base: WidgetRegistry = withEntries(
  {
    byKey: HashMap.empty<string, Widget>(),
    byKind: HashMap.empty<string, Widget>(),
    fallback: FallbackCard,
  },
  [
    forKind(queueKind, queueWidget),
    forKind(customQueueKind, customQueueWidget),
    forKind(processKind, processWidget),
    forKind(apiKind, apiWidget),
    forKind(fleetHealthKind, fleetHealthWidget),
    forKind(telemetryKind, telemetryWidget),
    forKind(shardMapKind, shardMapWidget),
    forKind(runKind, runWidget),
    forKind(resourceKind, ResourceCard),
  ],
);

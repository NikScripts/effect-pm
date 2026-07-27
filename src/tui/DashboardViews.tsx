/**
 * @module tui/DashboardViews
 *
 * TUI (Ink) skins for all default Dashboard View families — `Layer.succeed` only.
 * Ready {@link layer} for {@link View.react}.
 */
import { Box } from "ink";
import * as React from "react";
import { Option, Layer } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import * as Group from "../Group";
import { useAtomValue } from "../ui/atom-react";
import {
  isApiTag,
  isDaemonTag,
  isFleetHealthTag,
  isGateTag,
  isPriorityTag,
  isQueueTag,
  isShardMapTag,
  isTelemetryTag,
  queueBundle,
  type QueueTag,
} from "../ui/data";
import * as View from "../ui/View";
import * as ApiMetricsView from "../ui/ApiMetricsView";
import * as DaemonView from "../ui/DaemonView";
import * as DashboardViews from "../ui/DashboardViews";
import * as FleetHealthView from "../ui/FleetHealthView";
import * as GateView from "../ui/GateView";
import * as GroupView from "../ui/GroupView";
import * as HyperlinkView from "../ui/HyperlinkView";
import * as PriorityView from "../ui/PriorityView";
import * as ShardMapView from "../ui/ShardMapView";
import * as TelemetryView from "../ui/TelemetryView";
import * as WorkPoolView from "../ui/WorkPoolView";
import {
  DaemonCell,
  FallbackCell,
  GroupCell,
  PriorityCell,
  QueueCell,
} from "./cellWidgets";
import { FocusedDaemon, FocusedPriority } from "./focusWidgets";
import {
  ApiCell,
  FocusedApi,
  FocusedFleetHealth,
  FocusedGate,
  FocusedShardMap,
  FocusedTelemetry,
  FleetHealthCell,
  GateCell,
  ShardMapCell,
  TelemetryCell,
} from "./kindCells";
import { useRuntime } from "./runtime";
import {
  displayName,
  PageXL,
  type Priority,
  type Status,
  type View as QueueSnapshot,
} from "./queueWidget";

const statusOf = (phase: string, paused: boolean): Status =>
  phase === "off" ? "off" : phase === "draining" ? "draining" : paused ? "paused" : "running";

// ── cards ───────────────────────────────────────────────────────────────────

const GroupCardView: View.ViewComponent = (props) => {
  if (!Group.isGroup(props.tag)) return null;
  const chrome = View.useChrome();
  return (
    <GroupCell
      name={props.name ?? displayName(props.tag.key)}
      node={props.tag}
      width={chrome.width ?? 24}
      selected={chrome.selected === true}
    />
  );
};

const PoolCardView: View.ViewComponent = (props) => {
  if (!isQueueTag(props.tag)) return null;
  const chrome = View.useChrome();
  return (
    <QueueCell
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
      width={chrome.width}
      selected={chrome.selected}
    />
  );
};

const PriorityCardView: View.ViewComponent = (props) => {
  if (!isPriorityTag(props.tag)) return null;
  const chrome = View.useChrome();
  return (
    <PriorityCell
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
      width={chrome.width ?? 24}
      selected={chrome.selected === true}
    />
  );
};

const DaemonCardView: View.ViewComponent = (props) => {
  if (!isDaemonTag(props.tag)) return null;
  const chrome = View.useChrome();
  return (
    <DaemonCell
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
      width={chrome.width ?? 24}
      selected={chrome.selected === true}
    />
  );
};

const ApiCardView: View.ViewComponent = (props) => {
  if (!isApiTag(props.tag)) return null;
  const chrome = View.useChrome();
  const runtime = useRuntime();
  return (
    <ApiCell
      runtime={runtime}
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
      width={chrome.width ?? 24}
      selected={chrome.selected === true}
    />
  );
};

const FleetCardView: View.ViewComponent = (props) => {
  if (!isFleetHealthTag(props.tag)) return null;
  const chrome = View.useChrome();
  const runtime = useRuntime();
  return (
    <FleetHealthCell
      runtime={runtime}
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
      width={chrome.width ?? 24}
      selected={chrome.selected === true}
    />
  );
};

const TelemetryCardView: View.ViewComponent = (props) => {
  if (!isTelemetryTag(props.tag)) return null;
  const chrome = View.useChrome();
  const runtime = useRuntime();
  return (
    <TelemetryCell
      runtime={runtime}
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
      width={chrome.width ?? 24}
      selected={chrome.selected === true}
    />
  );
};

const ShardMapCardView: View.ViewComponent = (props) => {
  if (!isShardMapTag(props.tag)) return null;
  const chrome = View.useChrome();
  const runtime = useRuntime();
  return (
    <ShardMapCell
      runtime={runtime}
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
      width={chrome.width ?? 24}
      selected={chrome.selected === true}
    />
  );
};

const GateCardView: View.ViewComponent = (props) => {
  if (!isGateTag(props.tag)) return null;
  const chrome = View.useChrome();
  const runtime = useRuntime();
  return (
    <GateCell
      runtime={runtime}
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
      width={chrome.width ?? 24}
      selected={chrome.selected === true}
    />
  );
};

const HyperlinkCardView: View.ViewComponent = (props) => {
  const chrome = View.useChrome();
  return (
    <FallbackCell
      name={props.name ?? displayName(props.tag.key)}
      member={props.tag}
      width={chrome.width ?? 24}
      selected={chrome.selected === true}
    />
  );
};

// ── details ─────────────────────────────────────────────────────────────────

/** Read-only WorkPool detail body (PageXL) — Dashboard keeps edit/logs chrome. */
const QueueDetailPanel = (props: {
  readonly tag: QueueTag;
  readonly name: string;
  readonly width?: number;
}): React.ReactElement => {
  const bundle = queueBundle(useRuntime(), props.tag);
  const statusR = useAtomValue(bundle.status);
  const metricsR = useAtomValue(bundle.metrics);
  const trendR = useAtomValue(bundle.trend);
  const statusOpt = AsyncResult.isSuccess(statusR) ? statusR.value : Option.none();
  const s = Option.isSome(statusOpt) ? statusOpt.value : undefined;
  const metricsOpt = AsyncResult.isSuccess(metricsR) ? metricsR.value : Option.none();
  const m = Option.isSome(metricsOpt) ? metricsOpt.value : undefined;
  const trend = AsyncResult.isSuccess(trendR) ? trendR.value : [];
  const sizes: Record<Priority, number> = s?.sizes ?? { high: 0, normal: 0, low: 0 };
  const snapshot: QueueSnapshot = {
    name: props.name,
    status: statusOf(s?.phase ?? "running", s?.paused ?? false),
    sizes,
    pending: sizes.high + sizes.normal + sizes.low,
    completed: s?.completed ?? 0,
    wait: {
      high: m?.avgWaitMillis.high ?? 0,
      normal: m?.avgWaitMillis.normal ?? 0,
      low: m?.avgWaitMillis.low ?? 0,
    },
    execution: m?.avgExecutionMillis ?? 0,
    total: m?.avgTotalMillis ?? 0,
    throughput: m?.throughputPerSec ?? 0,
    trend,
  };
  return (
    <Box flexShrink={0}>
      <PageXL v={snapshot} width={props.width ?? 76} />
    </Box>
  );
};

const PoolDetailView: View.ViewComponent = (props) => {
  if (!isQueueTag(props.tag)) return null;
  const chrome = View.useChrome();
  return (
    <QueueDetailPanel
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
      width={chrome.width}
    />
  );
};

const PriorityDetailView: View.ViewComponent = (props) => {
  if (!isPriorityTag(props.tag)) return null;
  const chrome = View.useChrome();
  return (
    <FocusedPriority
      name={props.name ?? displayName(props.tag.key)}
      tag={props.tag}
      cols={chrome.cols ?? chrome.width ?? 80}
      rows={chrome.rows ?? 24}
      editMode={chrome.editMode}
    />
  );
};

const DaemonDetailView: View.ViewComponent = (props) => {
  if (!isDaemonTag(props.tag)) return null;
  const chrome = View.useChrome();
  return (
    <FocusedDaemon
      name={props.name ?? displayName(props.tag.key)}
      tag={props.tag}
      cols={chrome.cols ?? chrome.width ?? 80}
      rows={chrome.rows ?? 24}
      editMode={chrome.editMode}
    />
  );
};

const ApiDetailView: View.ViewComponent = (props) => {
  if (!isApiTag(props.tag)) return null;
  const chrome = View.useChrome();
  const runtime = useRuntime();
  return (
    <FocusedApi
      runtime={runtime}
      name={props.name ?? displayName(props.tag.key)}
      tag={props.tag}
      cols={chrome.cols ?? chrome.width ?? 80}
      rows={chrome.rows ?? 24}
    />
  );
};

const FleetDetailView: View.ViewComponent = (props) => {
  if (!isFleetHealthTag(props.tag)) return null;
  const chrome = View.useChrome();
  const runtime = useRuntime();
  return (
    <FocusedFleetHealth
      runtime={runtime}
      name={props.name ?? displayName(props.tag.key)}
      tag={props.tag}
      cols={chrome.cols ?? chrome.width ?? 80}
      rows={chrome.rows ?? 24}
    />
  );
};

const TelemetryDetailView: View.ViewComponent = (props) => {
  if (!isTelemetryTag(props.tag)) return null;
  const chrome = View.useChrome();
  const runtime = useRuntime();
  return (
    <FocusedTelemetry
      runtime={runtime}
      name={props.name ?? displayName(props.tag.key)}
      tag={props.tag}
      cols={chrome.cols ?? chrome.width ?? 80}
      rows={chrome.rows ?? 24}
    />
  );
};

const ShardMapDetailView: View.ViewComponent = (props) => {
  if (!isShardMapTag(props.tag)) return null;
  const chrome = View.useChrome();
  const runtime = useRuntime();
  return (
    <FocusedShardMap
      runtime={runtime}
      name={props.name ?? displayName(props.tag.key)}
      tag={props.tag}
      cols={chrome.cols ?? chrome.width ?? 80}
      rows={chrome.rows ?? 24}
    />
  );
};

const GateDetailView: View.ViewComponent = (props) => {
  if (!isGateTag(props.tag)) return null;
  const chrome = View.useChrome();
  const runtime = useRuntime();
  return (
    <FocusedGate
      runtime={runtime}
      name={props.name ?? displayName(props.tag.key)}
      tag={props.tag}
      cols={chrome.cols ?? chrome.width ?? 80}
      rows={chrome.rows ?? 24}
    />
  );
};

/**
 * TUI TSX provides for all {@link DashboardViews} handles.
 *
 * @public
 */
export const skins = Layer.mergeAll(
  Layer.succeed(GroupView.GroupCard, GroupCardView),
  Layer.succeed(WorkPoolView.PoolCard, PoolCardView),
  Layer.succeed(WorkPoolView.PoolDetail, PoolDetailView),
  Layer.succeed(PriorityView.PriorityCard, PriorityCardView),
  Layer.succeed(PriorityView.PriorityDetail, PriorityDetailView),
  Layer.succeed(DaemonView.DaemonCard, DaemonCardView),
  Layer.succeed(DaemonView.DaemonDetail, DaemonDetailView),
  Layer.succeed(ApiMetricsView.ApiCard, ApiCardView),
  Layer.succeed(ApiMetricsView.ApiDetail, ApiDetailView),
  Layer.succeed(FleetHealthView.FleetCard, FleetCardView),
  Layer.succeed(FleetHealthView.FleetDetail, FleetDetailView),
  Layer.succeed(TelemetryView.TelemetryCard, TelemetryCardView),
  Layer.succeed(TelemetryView.TelemetryDetail, TelemetryDetailView),
  Layer.succeed(ShardMapView.ShardMapCard, ShardMapCardView),
  Layer.succeed(ShardMapView.ShardMapDetail, ShardMapDetailView),
  Layer.succeed(GateView.GateCard, GateCardView),
  Layer.succeed(GateView.GateDetail, GateDetailView),
  Layer.succeed(HyperlinkView.HyperlinkCard, HyperlinkCardView),
);

/**
 * Fully provided Dashboard View Layer for the TUI (`R = never`) — ready for {@link View.react}.
 *
 * @public
 */
export const layer = DashboardViews.layer.pipe(
  Layer.provideMerge(skins),
  Layer.provideMerge(View.base),
);

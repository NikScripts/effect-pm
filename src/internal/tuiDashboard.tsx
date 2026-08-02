/**
 * Internal eng for {@link ../tui/Dashboard} — View.provide bag, ready `layer`,
 * and batteries `<Dashboard>` wiring.
 */
import { Box, Text } from "ink";
import * as React from "react";
import { Option, Layer } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import * as Group from "../Group";
import * as Observe from "../Observe";
import { RegistryProvider, useAtomValue } from "../ui/atom-react";
import {
  isApiTag,
  isDaemonTag,
  isFleetHealthTag,
  isGateTag,
  isPriorityTag,
  isQueueTag,
  isShardMapTag,
  isTelemetryTag,
  type DashboardRuntime,
  type GroupNode,
  type QueueTag,
} from "../ui/data";
import * as GroupNav from "../ui/GroupNav";
import * as Route from "../ui/Route";
import * as Router from "../ui/Router";
import * as View from "../ui/View";
import * as Ui from "../ui/Ui";
import { WidgetsProvider } from "../ui/widgetsContext";
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
import { DashboardShell } from "../tui/DashboardShell";
import { RuntimeProvider } from "../tui/runtime";
import {
  base,
  DaemonCell,
  FallbackCell,
  GroupCell,
  PriorityCell,
  QueueCell,
  type TuiWidgetRegistry,
} from "../tui/cellWidgets";
import { FocusedDaemon, FocusedPriority, LogTail } from "../tui/focusWidgets";
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
} from "../tui/kindCells";
import {
  displayName,
  PageXL,
  type Priority,
  type Status,
  type View as QueueSnapshot,
} from "../tui/queueWidget";

const statusOf = (lifecycleTag: string): Status =>
  lifecycleTag === "Idle"
    ? "idle"
    : lifecycleTag === "Off"
      ? "off"
      : lifecycleTag === "Draining"
        ? "draining"
        : lifecycleTag === "Paused"
          ? "paused"
          : "running";

const lifecycleTagOf = (
  lifecycleR: AsyncResult.AsyncResult<{ readonly _tag: string }, unknown>,
): string =>
  AsyncResult.isSuccess(lifecycleR)
    ? lifecycleR.value._tag ?? "Running"
    : "Running";

// ── cards ───────────────────────────────────────────────────────────────────

const GroupCardView: View.View = (props) => {
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

const PoolCardView: View.View = (props) => {
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

const PriorityCardView: View.View = (props) => {
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

const DaemonCardView: View.View = (props) => {
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

const ApiCardView: View.View = (props) => {
  if (!isApiTag(props.tag)) return null;
  const chrome = View.useChrome();
  return (
    <ApiCell
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
      width={chrome.width ?? 24}
      selected={chrome.selected === true}
    />
  );
};

const FleetCardView: View.View = (props) => {
  if (!isFleetHealthTag(props.tag)) return null;
  const chrome = View.useChrome();
  return (
    <FleetHealthCell
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
      width={chrome.width ?? 24}
      selected={chrome.selected === true}
    />
  );
};

const TelemetryCardView: View.View = (props) => {
  if (!isTelemetryTag(props.tag)) return null;
  const chrome = View.useChrome();
  return (
    <TelemetryCell
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
      width={chrome.width ?? 24}
      selected={chrome.selected === true}
    />
  );
};

const ShardMapCardView: View.View = (props) => {
  if (!isShardMapTag(props.tag)) return null;
  const chrome = View.useChrome();
  return (
    <ShardMapCell
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
      width={chrome.width ?? 24}
      selected={chrome.selected === true}
    />
  );
};

const GateCardView: View.View = (props) => {
  if (!isGateTag(props.tag)) return null;
  const chrome = View.useChrome();
  return (
    <GateCell
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
      width={chrome.width ?? 24}
      selected={chrome.selected === true}
    />
  );
};

const HyperlinkCardView: View.View = (props) => {
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
  const bundle = Observe.use(props.tag, WorkPoolView.pack);
  const statusR = useAtomValue(bundle.status);
  const lifecycleR = useAtomValue(bundle.lifecycle);
  const metricsR = useAtomValue(bundle.metrics);
  const trendR = useAtomValue(bundle.trend);
  const statusOpt = AsyncResult.isSuccess(statusR) ? statusR.value : Option.none();
  const s = Option.isSome(statusOpt) ? statusOpt.value : undefined;
  const metricsOpt = AsyncResult.isSuccess(metricsR) ? metricsR.value : Option.none();
  const m = Option.isSome(metricsOpt) ? metricsOpt.value : undefined;
  const trend = AsyncResult.isSuccess(trendR) ? trendR.value : [];
  const sizes: Record<Priority, number> = s?.sizes ?? { high: 0, normal: 0, low: 0 };
  const lifecycleTag = lifecycleTagOf(lifecycleR);
  const snapshot: QueueSnapshot = {
    name: props.name,
    status: statusOf(lifecycleTag),
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

const PoolDetailView: View.View = (props) => {
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

const PriorityDetailView: View.View = (props) => {
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

const DaemonDetailView: View.View = (props) => {
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

const PoolPageView: View.View = (props) => {
  if (!isQueueTag(props.tag)) return null;
  const nav = Router.useRouter();
  const bundle = Observe.use(props.tag, WorkPoolView.pack);
  const logsR = useAtomValue(bundle.logs);
  if (Route.viewOf(Route.targetOf(nav.match)) !== "logs") return null;
  const logs = AsyncResult.isSuccess(logsR) ? logsR.value : [];
  return (
    <Box flexDirection="column">
      <Text>logs · {props.name ?? displayName(props.tag.key)} · Esc back</Text>
      <LogTail logs={logs} visible={20} />
    </Box>
  );
};

const DaemonPageView: View.View = (props) => {
  if (!isDaemonTag(props.tag)) return null;
  const nav = Router.useRouter();
  const bundle = Observe.use(props.tag, DaemonView.pack);
  const logsR = useAtomValue(bundle.logs);
  const scheduleR = useAtomValue(bundle.schedule);
  const view = Route.viewOf(Route.targetOf(nav.match));
  if (view === "logs") {
    const logs = AsyncResult.isSuccess(logsR) ? logsR.value : [];
    return (
      <Box flexDirection="column">
        <Text>logs · {props.name ?? displayName(props.tag.key)} · Esc back</Text>
        <LogTail logs={logs} visible={20} />
      </Box>
    );
  }
  if (view === "schedule") {
    const entries = AsyncResult.isSuccess(scheduleR) ? scheduleR.value : [];
    return (
      <Box flexDirection="column">
        <Text>schedule · {props.name ?? displayName(props.tag.key)} · Esc back</Text>
        <Text dimColor>{entries.length} window(s)</Text>
      </Box>
    );
  }
  return null;
};

const ApiDetailView: View.View = (props) => {
  if (!isApiTag(props.tag)) return null;
  const chrome = View.useChrome();
  return (
    <FocusedApi
      name={props.name ?? displayName(props.tag.key)}
      tag={props.tag}
      cols={chrome.cols ?? chrome.width ?? 80}
      rows={chrome.rows ?? 24}
    />
  );
};

const FleetDetailView: View.View = (props) => {
  if (!isFleetHealthTag(props.tag)) return null;
  const chrome = View.useChrome();
  return (
    <FocusedFleetHealth
      name={props.name ?? displayName(props.tag.key)}
      tag={props.tag}
      cols={chrome.cols ?? chrome.width ?? 80}
      rows={chrome.rows ?? 24}
    />
  );
};

const TelemetryDetailView: View.View = (props) => {
  if (!isTelemetryTag(props.tag)) return null;
  const chrome = View.useChrome();
  return (
    <FocusedTelemetry
      name={props.name ?? displayName(props.tag.key)}
      tag={props.tag}
      cols={chrome.cols ?? chrome.width ?? 80}
      rows={chrome.rows ?? 24}
    />
  );
};

const ShardMapDetailView: View.View = (props) => {
  if (!isShardMapTag(props.tag)) return null;
  const chrome = View.useChrome();
  return (
    <FocusedShardMap
      name={props.name ?? displayName(props.tag.key)}
      tag={props.tag}
      cols={chrome.cols ?? chrome.width ?? 80}
      rows={chrome.rows ?? 24}
    />
  );
};

const GateDetailView: View.View = (props) => {
  if (!isGateTag(props.tag)) return null;
  const chrome = View.useChrome();
  return (
    <FocusedGate
      name={props.name ?? displayName(props.tag.key)}
      tag={props.tag}
      cols={chrome.cols ?? chrome.width ?? 80}
      rows={chrome.rows ?? 24}
    />
  );
};

/**
 * TUI TSX implementations for all {@link DashboardViews} handles.
 *
 * @internal
 */
export const componentsLayer = Layer.mergeAll(
  View.provide(GroupView.GroupCard, GroupCardView),
  View.provide(WorkPoolView.PoolCard, PoolCardView),
  View.provide(WorkPoolView.PoolDetail, PoolDetailView),
  View.provide(WorkPoolView.PoolPage, PoolPageView),
  View.provide(PriorityView.PriorityCard, PriorityCardView),
  View.provide(PriorityView.PriorityDetail, PriorityDetailView),
  View.provide(DaemonView.DaemonCard, DaemonCardView),
  View.provide(DaemonView.DaemonDetail, DaemonDetailView),
  View.provide(DaemonView.DaemonPage, DaemonPageView),
  View.provide(ApiMetricsView.ApiCard, ApiCardView),
  View.provide(ApiMetricsView.ApiDetail, ApiDetailView),
  View.provide(FleetHealthView.FleetCard, FleetCardView),
  View.provide(FleetHealthView.FleetDetail, FleetDetailView),
  View.provide(TelemetryView.TelemetryCard, TelemetryCardView),
  View.provide(TelemetryView.TelemetryDetail, TelemetryDetailView),
  View.provide(ShardMapView.ShardMapCard, ShardMapCardView),
  View.provide(ShardMapView.ShardMapDetail, ShardMapDetailView),
  View.provide(GateView.GateCard, GateCardView),
  View.provide(GateView.GateDetail, GateDetailView),
  View.provide(HyperlinkView.HyperlinkCard, HyperlinkCardView),
);

/**
 * Fully provided Dashboard View Layer for the TUI (`R = never`) — ready for {@link Ui.react}.
 *
 * @internal
 */
export const layer = DashboardViews.layer.pipe(
  Layer.provideMerge(componentsLayer),
  Layer.provideMerge(Ui.base),
);

const routesFor = (group: GroupNode) =>
  Route.make("dashboard").add(
    Route.group("hub", { topLevel: true }).fromEffect(Group.asRoutes(group)),
  );

/**
 * Batteries-included terminal dashboard wiring.
 *
 * @internal
 */
export const Dashboard = <R, ER>(props: {
  readonly runtime: DashboardRuntime<R, ER>;
  readonly group: GroupNode;
  readonly path?: ReadonlyArray<string>;
  readonly views?: Layer.Layer<never, never, View.Registry>;
  readonly widgets?: TuiWidgetRegistry;
}): React.ReactElement => {
  const ui = React.useMemo(() => {
    const views = Layer.mergeAll(
      DashboardViews.layer,
      props.views ?? Layer.empty,
    ).pipe(
      Layer.provideMerge(componentsLayer),
      Layer.provideMerge(Ui.base),
    );
    const composed = Ui.compose({
      views,
      router: Router.memory(routesFor(props.group)),
      group: props.group,
    });
    for (const key of props.path ?? []) {
      GroupNav.openKey(props.group, composed.router, key);
    }
    return composed;
  }, [props.group, props.views, props.path]);

  return (
    <RegistryProvider>
      <ui.Provider>
        <WidgetsProvider registry={props.widgets ?? base}>
          <RuntimeProvider runtime={props.runtime}>
            <DashboardShell group={props.group} />
          </RuntimeProvider>
        </WidgetsProvider>
      </ui.Provider>
    </RegistryProvider>
  );
};

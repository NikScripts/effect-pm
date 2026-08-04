/**
 * Internal eng for {@link ../web/Dashboard} — View.succeed bag, ready `layer`,
 * and batteries `<Dashboard>` / `<DashboardView>` wiring.
 */
import * as React from "react";
import { Layer } from "effect";
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
} from "../ui/data";
import * as Group from "../Group";
import * as View from "../ui/View";
import * as ApiMetricsView from "../ui/ApiMetricsView";
import * as DaemonView from "../ui/DaemonView";
import * as DashboardViews from "../ui/DashboardViews";
import * as FleetHealthView from "../ui/FleetHealthView";
import * as GateView from "../ui/GateView";
import * as GroupView from "../ui/GroupView";
import * as HyperlinkView from "../ui/HyperlinkView";
import * as GroupNav from "../ui/GroupNav";
import * as Route from "../ui/Route";
import * as Router from "../ui/Router";
import * as PriorityView from "../ui/PriorityView";
import * as ShardMapView from "../ui/ShardMapView";
import * as TelemetryView from "../ui/TelemetryView";
import * as WorkPoolView from "../ui/WorkPoolView";
import { type WidgetRegistry } from "../ui/widgetRegistry";
import { RegistryProvider, useAtomValue } from "../ui/atom-react";
import { WidgetsProvider } from "../ui/widgetsContext";
import { AsyncResult } from "effect/unstable/reactivity";
import * as Observe from "../Observe";
import { RuntimeProvider } from "../web/runtime";
import { ViewTransitionProvider } from "../web/useViewTransition";
import type { Widget } from "../web/widget-registry";
import { DebugConsole } from "../web/debug-console";
import { DashboardShell } from "../web/DashboardShell";
import {
  ApiCard,
  ApiEndpointTable,
  ApiMetricChart,
  ApiStats,
  ApiStatusBadge,
  base,
  DaemonCard,
  DaemonControls,
  DaemonStats,
  DaemonStatusBadge,
  displayName,
  FleetHealthCard,
  FleetHealthDetail as FleetHealthDetailWidget,
  GateCard,
  GateDetail as GateDetailWidget,
  GroupCard,
  HyperlinkCard,
  HyperlinkReadinessBanner,
  PriorityCard,
  PriorityDetail as PriorityDetailWidget,
  QueueCard,
  QueueDetailPanel,
  ScheduleEditor,
  ShardMapCard,
  ShardMapDetail as ShardMapDetailWidget,
  TelemetryCard,
  TelemetryDetail as TelemetryDetailWidget,
} from "../web/widgets";
import { LogsPage, SchedulePage } from "../web/resourcePages";

import * as Views from "../ui/Views";
// ── cards (presentational — Cell wraps with button) ─────────────────────────

const GroupCardView: View.View = (props) => {
  if (!Group.isGroup(props.tag)) return null;
  return <GroupCard node={props.tag} name={props.name ?? displayName(props.tag.key)} />;
};

const PoolCardView: View.View = (props) => {
  if (!isQueueTag(props.tag)) return null;
  return (
    <QueueCard
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
    />
  );
};

const PriorityCardView: View.View = (props) => {
  if (!isPriorityTag(props.tag)) return null;
  return (
    <PriorityCard
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
    />
  );
};

const DaemonCardView: View.View = (props) => {
  if (!isDaemonTag(props.tag)) return null;
  return (
    <DaemonCard
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
    />
  );
};

const ApiCardView: View.View = (props) => {
  if (!isApiTag(props.tag)) return null;
  return (
    <ApiCard
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
    />
  );
};

const FleetCardView: View.View = (props) => {
  if (!isFleetHealthTag(props.tag)) return null;
  return (
    <FleetHealthCard
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
    />
  );
};

const TelemetryCardView: View.View = (props) => {
  if (!isTelemetryTag(props.tag)) return null;
  return (
    <TelemetryCard
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
    />
  );
};

const ShardMapCardView: View.View = (props) => {
  if (!isShardMapTag(props.tag)) return null;
  return (
    <ShardMapCard
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
    />
  );
};

const GateCardView: View.View = (props) => {
  if (!isGateTag(props.tag)) return null;
  return (
    <GateCard
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
    />
  );
};

const HyperlinkCardView: View.View = (props) => (
  <HyperlinkCard
    tag={props.tag}
    name={props.name ?? displayName(props.tag.key)}
  />
);

// ── details ─────────────────────────────────────────────────────────────────

const openView = (router: Router.Service, view: string): void => {
  const target = Route.targetOf(router.match);
  if (target === undefined) return;
  router.go(GroupNav.toHref([...target.keys, view]));
};

const closeView = (router: Router.Service): void => {
  const target = Route.targetOf(router.match);
  if (target === undefined) return;
  router.go(GroupNav.toHref(target.keys.slice(0, -1)), { replace: true });
};

const PoolDetailView: View.View = (props) => {
  if (!isQueueTag(props.tag)) return null;
  return <QueueDetailPanel tag={props.tag} />;
};

const PriorityDetailView: View.View = (props) => {
  if (!isPriorityTag(props.tag)) return null;
  // Shell owns back/title; body-only when Router is present (lock J).
  const nav = Router.useRouterOption();
  return (
    <PriorityDetailWidget
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
      chrome={nav === null}
    />
  );
};

const DaemonDetailView: View.View = (props) => {
  if (!isDaemonTag(props.tag)) return null;
  const nav = Router.useRouterOption();
  const bundle = Observe.use(props.tag, DaemonView.pack);
  const statusR = useAtomValue(bundle.status);
  const s = AsyncResult.isSuccess(statusR) ? statusR.value : undefined;
  const [locked, setLocked] = React.useState(true);
  return (
    <>
      <div className="flex justify-end">
        <DaemonStatusBadge supervising={s?.supervising} />
      </div>
      <HyperlinkReadinessBanner tag={props.tag} />
      <DaemonStats bundle={bundle} />
      <DaemonControls
        bundle={bundle}
        locked={locked}
        onToggleLock={() => setLocked((l) => !l)}
      />
      <ScheduleEditor
        bundle={bundle}
        onOpenFull={
          nav !== null && isDaemonTag(props.tag)
            ? () => openView(nav, "schedule")
            : undefined
        }
      />
    </>
  );
};

const ApiDetailView: View.View = (props) => {
  if (!isApiTag(props.tag)) return null;
  const bundle = Observe.use(props.tag, ApiMetricsView.pack);
  const statusR = useAtomValue(bundle.status);
  const s = AsyncResult.isSuccess(statusR) ? statusR.value : undefined;
  return (
    <>
      <div className="flex justify-end">
        <ApiStatusBadge requests={s?.requestsTotal ?? 0} errors={s?.errorsTotal ?? 0} />
      </div>
      <HyperlinkReadinessBanner tag={props.tag} />
      <ApiStats bundle={bundle} />
      <div className="overflow-hidden rounded-xl border bg-card p-3">
        <ApiMetricChart bundle={bundle} />
      </div>
      <ApiEndpointTable bundle={bundle} />
    </>
  );
};

const FleetDetailView: View.View = (props) => {
  if (!isFleetHealthTag(props.tag)) return null;
  const nav = Router.useRouterOption();
  return (
    <FleetHealthDetailWidget
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
      chrome={nav === null}
    />
  );
};

const TelemetryDetailView: View.View = (props) => {
  if (!isTelemetryTag(props.tag)) return null;
  const nav = Router.useRouterOption();
  return (
    <TelemetryDetailWidget
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
      chrome={nav === null}
    />
  );
};

const ShardMapDetailView: View.View = (props) => {
  if (!isShardMapTag(props.tag)) return null;
  const nav = Router.useRouterOption();
  return (
    <ShardMapDetailWidget
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
      chrome={nav === null}
    />
  );
};

const GateDetailView: View.View = (props) => {
  if (!isGateTag(props.tag)) return null;
  const nav = Router.useRouterOption();
  return (
    <GateDetailWidget
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
      chrome={nav === null}
    />
  );
};

/** WorkPool page — `/…/logs`. */
const PoolPageView: View.View = (props) => {
  if (!isQueueTag(props.tag)) return null;
  const nav = Router.useRouter();
  if (Route.viewOf(Route.targetOf(nav.match)) !== "logs") return null;
  return <LogsPage tag={props.tag} onClose={() => closeView(nav)} />;
};

/** Daemon page — `/…/logs` or `/…/schedule`. */
const DaemonPageView: View.View = (props) => {
  if (!isDaemonTag(props.tag)) return null;
  const nav = Router.useRouter();
  const view = Route.viewOf(Route.targetOf(nav.match));
  if (view === "logs") {
    return <LogsPage tag={props.tag} onClose={() => closeView(nav)} />;
  }
  if (view === "schedule") {
    return <SchedulePage tag={props.tag} onClose={() => closeView(nav)} />;
  }
  return null;
};

/**
 * Web TSX implementations for all {@link DashboardViews} handles.
 *
 * @internal
 */
export const componentsLayer = Layer.mergeAll(
  View.succeed(GroupView.GroupCard, GroupCardView),
  View.succeed(WorkPoolView.PoolCard, PoolCardView),
  View.succeed(WorkPoolView.PoolDetail, PoolDetailView),
  View.succeed(WorkPoolView.PoolPage, PoolPageView),
  View.succeed(PriorityView.PriorityCard, PriorityCardView),
  View.succeed(PriorityView.PriorityDetail, PriorityDetailView),
  View.succeed(DaemonView.DaemonCard, DaemonCardView),
  View.succeed(DaemonView.DaemonDetail, DaemonDetailView),
  View.succeed(DaemonView.DaemonPage, DaemonPageView),
  View.succeed(ApiMetricsView.ApiCard, ApiCardView),
  View.succeed(ApiMetricsView.ApiDetail, ApiDetailView),
  View.succeed(FleetHealthView.FleetCard, FleetCardView),
  View.succeed(FleetHealthView.FleetDetail, FleetDetailView),
  View.succeed(TelemetryView.TelemetryCard, TelemetryCardView),
  View.succeed(TelemetryView.TelemetryDetail, TelemetryDetailView),
  View.succeed(ShardMapView.ShardMapCard, ShardMapCardView),
  View.succeed(ShardMapView.ShardMapDetail, ShardMapDetailView),
  View.succeed(GateView.GateCard, GateCardView),
  View.succeed(GateView.GateDetail, GateDetailView),
  View.succeed(HyperlinkView.HyperlinkCard, HyperlinkCardView),
);

/**
 * Fully provided Dashboard View Layer for the web (`R = never`) — ready for {@link Views.react}.
 *
 * @internal
 */
export const layer = DashboardViews.layer.pipe(
  Layer.provideMerge(componentsLayer),
  Layer.provideMerge(Views.base),
);

const routesFor = (group: GroupNode) =>
  Route.make("dashboard").add(
    Route.group("hub", { topLevel: true }).fromEffect(Group.asRoutes(group)),
  );

/**
 * Drill-down view + runtime (no outer registry / view-transition providers).
 *
 * @internal
 */
export const DashboardView = <R, ER>(props: {
  readonly runtime: DashboardRuntime<R, ER>;
  readonly group: GroupNode;
  readonly views?: Layer.Layer<never, never, Views.Registry>;
}): React.ReactElement => {
  const ui = React.useMemo(() => {
    const views = Layer.mergeAll(
      DashboardViews.layer,
      props.views ?? Layer.empty,
    ).pipe(
      Layer.provideMerge(componentsLayer),
      Layer.provideMerge(Views.base),
    );
    return Views.compose({
      views,
      router: Router.history(routesFor(props.group)),
      group: props.group,
    });
  }, [props.group, props.views]);
  return (
    <ui.Provider>
      <RuntimeProvider runtime={props.runtime}>
        <div className="font-mono">
          <DashboardShell group={props.group} />
        </div>
      </RuntimeProvider>
    </ui.Provider>
  );
};

/**
 * Batteries-included web dashboard wiring.
 *
 * @internal
 */
export const Dashboard = <R, ER>(props: {
  readonly runtime: DashboardRuntime<R, ER>;
  readonly group: GroupNode;
  readonly views?: Layer.Layer<never, never, Views.Registry>;
  readonly widgets?: WidgetRegistry<Widget>;
}): React.ReactElement => (
  <RegistryProvider>
    <WidgetsProvider registry={props.widgets ?? base}>
      <ViewTransitionProvider>
        <DashboardView
          runtime={props.runtime}
          group={props.group}
          views={props.views}
        />
        <DebugConsole />
      </ViewTransitionProvider>
    </WidgetsProvider>
  </RegistryProvider>
);

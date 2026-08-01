/**
 * Web (DOM) View Tag implementations for batteries Dashboard.
 * Public surface: {@link ../web/Dashboard.componentsLayer} / {@link ../web/Dashboard.layer}.
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
import { AsyncResult } from "effect/unstable/reactivity";
import { useAtomValue } from "../ui/atom-react";
import * as Observe from "../Observe";
import {
  ApiCard,
  ApiEndpointTable,
  ApiMetricChart,
  ApiStats,
  ApiStatusBadge,
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
 * @public
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
 * Fully provided Dashboard View Layer for the web (`R = never`) — ready for {@link View.react}.
 *
 * @public
 */
export const layer = DashboardViews.layer.pipe(
  Layer.provideMerge(componentsLayer),
  Layer.provideMerge(View.base),
);

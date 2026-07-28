/**
 * @module web/DashboardViews
 *
 * Web (DOM) skins for all default Dashboard View families — `View.provide` only.
 * Ready {@link layer} for {@link View.react}.
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
import * as Navigator from "../ui/Navigator";
import * as PriorityView from "../ui/PriorityView";
import * as ShardMapView from "../ui/ShardMapView";
import * as TelemetryView from "../ui/TelemetryView";
import * as WorkPoolView from "../ui/WorkPoolView";
import { useApiBundle, useDaemonBundle } from "./runtime";
import {
  ApiCard,
  ApiEndpointTable,
  ApiMetricChart,
  ApiStats,
  DaemonCard,
  DaemonControls,
  DaemonStats,
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
} from "./widgets";

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

const PoolDetailView: View.View = (props) => {
  if (!isQueueTag(props.tag)) return null;
  return <QueueDetailPanel tag={props.tag} />;
};

const PriorityDetailView: View.View = (props) => {
  if (!isPriorityTag(props.tag)) return null;
  // Shell Outlet owns back/title; body-only when Navigator is present (lock J).
  const nav = Navigator.useNavigatorOption();
  return (
    <PriorityDetailWidget
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
      onBack={nav?.back}
      chrome={nav === null}
    />
  );
};

const DaemonDetailView: View.View = (props) => {
  if (!isDaemonTag(props.tag)) return null;
  const nav = Navigator.useNavigatorOption();
  const bundle = useDaemonBundle(props.tag);
  const [locked, setLocked] = React.useState(true);
  return (
    <>
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
            ? () => nav.openSchedule(props.tag)
            : undefined
        }
      />
    </>
  );
};

const ApiDetailView: View.View = (props) => {
  if (!isApiTag(props.tag)) return null;
  const bundle = useApiBundle(props.tag);
  return (
    <>
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
  const nav = Navigator.useNavigatorOption();
  return (
    <FleetHealthDetailWidget
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
      onBack={nav?.back}
      chrome={nav === null}
    />
  );
};

const TelemetryDetailView: View.View = (props) => {
  if (!isTelemetryTag(props.tag)) return null;
  const nav = Navigator.useNavigatorOption();
  return (
    <TelemetryDetailWidget
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
      onBack={nav?.back}
      chrome={nav === null}
    />
  );
};

const ShardMapDetailView: View.View = (props) => {
  if (!isShardMapTag(props.tag)) return null;
  const nav = Navigator.useNavigatorOption();
  return (
    <ShardMapDetailWidget
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
      onBack={nav?.back}
      chrome={nav === null}
    />
  );
};

const GateDetailView: View.View = (props) => {
  if (!isGateTag(props.tag)) return null;
  const nav = Navigator.useNavigatorOption();
  return (
    <GateDetailWidget
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
      onBack={nav?.back}
      chrome={nav === null}
    />
  );
};

/**
 * Web TSX provides for all {@link DashboardViews} handles.
 *
 * @public
 */
export const skins = Layer.mergeAll(
  View.provide(GroupView.GroupCard, GroupCardView),
  View.provide(WorkPoolView.PoolCard, PoolCardView),
  View.provide(WorkPoolView.PoolDetail, PoolDetailView),
  View.provide(PriorityView.PriorityCard, PriorityCardView),
  View.provide(PriorityView.PriorityDetail, PriorityDetailView),
  View.provide(DaemonView.DaemonCard, DaemonCardView),
  View.provide(DaemonView.DaemonDetail, DaemonDetailView),
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
  Layer.provideMerge(skins),
  Layer.provideMerge(View.base),
);

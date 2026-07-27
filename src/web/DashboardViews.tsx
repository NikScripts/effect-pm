/**
 * @module web/DashboardViews
 *
 * Web (DOM) skins for all default Dashboard View families — `Layer.succeed` only.
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
import * as View from "../ui/View";
import * as ApiMetricsView from "../ui/ApiMetricsView";
import * as DaemonView from "../ui/DaemonView";
import * as DashboardViews from "../ui/DashboardViews";
import * as FleetHealthView from "../ui/FleetHealthView";
import * as GateView from "../ui/GateView";
import * as HyperlinkView from "../ui/HyperlinkView";
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

const PoolCardView: View.ViewComponent = (props) => {
  if (!isQueueTag(props.tag)) return null;
  return (
    <QueueCard
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
    />
  );
};

const PriorityCardView: View.ViewComponent = (props) => {
  if (!isPriorityTag(props.tag)) return null;
  return (
    <PriorityCard
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
    />
  );
};

const DaemonCardView: View.ViewComponent = (props) => {
  if (!isDaemonTag(props.tag)) return null;
  return (
    <DaemonCard
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
    />
  );
};

const ApiCardView: View.ViewComponent = (props) => {
  if (!isApiTag(props.tag)) return null;
  return (
    <ApiCard
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
    />
  );
};

const FleetCardView: View.ViewComponent = (props) => {
  if (!isFleetHealthTag(props.tag)) return null;
  return (
    <FleetHealthCard
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
    />
  );
};

const TelemetryCardView: View.ViewComponent = (props) => {
  if (!isTelemetryTag(props.tag)) return null;
  return (
    <TelemetryCard
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
    />
  );
};

const ShardMapCardView: View.ViewComponent = (props) => {
  if (!isShardMapTag(props.tag)) return null;
  return (
    <ShardMapCard
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
    />
  );
};

const GateCardView: View.ViewComponent = (props) => {
  if (!isGateTag(props.tag)) return null;
  return (
    <GateCard
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
    />
  );
};

const HyperlinkCardView: View.ViewComponent = (props) => (
  <HyperlinkCard
    tag={props.tag}
    name={props.name ?? displayName(props.tag.key)}
    onOpen={() => {}}
  />
);

// ── details ─────────────────────────────────────────────────────────────────

const PoolDetailView: View.ViewComponent = (props) => {
  if (!isQueueTag(props.tag)) return null;
  return <QueueDetailPanel tag={props.tag} />;
};

const PriorityDetailView: View.ViewComponent = (props) => {
  if (!isPriorityTag(props.tag)) return null;
  const onBack = View.useChrome().onBack;
  if (onBack === undefined) return null;
  return (
    <PriorityDetailWidget
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
      onBack={onBack}
    />
  );
};

const DaemonDetailView: View.ViewComponent = (props) => {
  if (!isDaemonTag(props.tag)) return null;
  const chrome = View.useChrome();
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
      <ScheduleEditor bundle={bundle} onOpenFull={chrome.onOpenSchedule} />
    </>
  );
};

const ApiDetailView: View.ViewComponent = (props) => {
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

const FleetDetailView: View.ViewComponent = (props) => {
  if (!isFleetHealthTag(props.tag)) return null;
  const onBack = View.useChrome().onBack;
  if (onBack === undefined) return null;
  return (
    <FleetHealthDetailWidget
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
      onBack={onBack}
    />
  );
};

const TelemetryDetailView: View.ViewComponent = (props) => {
  if (!isTelemetryTag(props.tag)) return null;
  const onBack = View.useChrome().onBack;
  if (onBack === undefined) return null;
  return (
    <TelemetryDetailWidget
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
      onBack={onBack}
    />
  );
};

const ShardMapDetailView: View.ViewComponent = (props) => {
  if (!isShardMapTag(props.tag)) return null;
  const onBack = View.useChrome().onBack;
  if (onBack === undefined) return null;
  return (
    <ShardMapDetailWidget
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
      onBack={onBack}
    />
  );
};

const GateDetailView: View.ViewComponent = (props) => {
  if (!isGateTag(props.tag)) return null;
  const onBack = View.useChrome().onBack;
  if (onBack === undefined) return null;
  return (
    <GateDetailWidget
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
      onBack={onBack}
    />
  );
};

/**
 * Web TSX provides for all {@link DashboardViews} handles.
 *
 * @public
 */
export const skins = Layer.mergeAll(
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
 * Fully provided Dashboard View Layer for the web (`R = never`) — ready for {@link View.react}.
 *
 * @public
 */
export const layer = DashboardViews.layer.pipe(
  Layer.provideMerge(skins),
  Layer.provideMerge(View.base),
);

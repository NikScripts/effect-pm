/**
 * @module tui/WorkPoolView
 *
 * TUI (Ink) skins for shared {@link WorkPoolView} handles — `Layer.succeed` only.
 */
import { Box } from "ink";
import * as React from "react";
import { Option, Layer } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { useAtomValue } from "../ui/atom-react";
import { isQueueTag, queueBundle, type QueueTag } from "../ui/data";
import * as View from "../ui/View";
import * as WorkPoolView from "../ui/WorkPoolView";
import { QueueCell } from "./cellWidgets";
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

const PoolCardView: View.ViewComponent = (props) => {
  if (!isQueueTag(props.tag)) return null;
  return (
    <QueueCell
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
    />
  );
};

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
  return (
    <QueueDetailPanel
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
    />
  );
};

/**
 * TUI TSX provides for {@link WorkPoolView.PoolCard} / {@link WorkPoolView.PoolDetail}.
 *
 * @public
 */
export const skins: Layer.Layer<
  View.ViewId<"hyperlink/view/pool-card"> | View.ViewId<"hyperlink/view/pool-detail">
> = Layer.mergeAll(
  Layer.succeed(WorkPoolView.PoolCard, PoolCardView),
  Layer.succeed(WorkPoolView.PoolDetail, PoolDetailView),
);

/**
 * Fully provided WorkPool View Layer for the TUI (`R = never`) — ready for {@link View.react}.
 *
 * @public
 */
export const layer = WorkPoolView.layer.pipe(
  Layer.provideMerge(skins),
  Layer.provideMerge(View.base),
);

export { PoolCard, PoolDetail } from "../ui/WorkPoolView";

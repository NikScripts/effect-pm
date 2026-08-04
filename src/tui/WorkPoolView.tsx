/**
 * @module tui/WorkPoolView
 *
 * TUI (Ink) implementations for shared {@link WorkPoolView} handles — `View.succeed` only.
 */
import { Box, Text } from "ink";
import * as React from "react";
import { Option, Layer } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { useAtomValue } from "../ui/atom-react";
import { isQueueTag, type QueueTag } from "../ui/data";
import * as Route from "../ui/Route";
import * as Router from "../ui/Router";
import * as View from "../ui/View";
import * as Observe from "../Observe";
import * as WorkPoolView from "../ui/WorkPoolView";
import { QueueCell } from "./cellWidgets";
import { LogTail } from "./focusWidgets";
import * as Views from "../ui/Views";
import {
  displayName,
  PageXL,
  type Priority,
  type Status,
  type View as QueueSnapshot,
} from "./queueWidget";

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

const PoolPageView: View.View = (props) => {
  if (!isQueueTag(props.tag)) return null;
  const nav = Router.useRouter();
  const bundle = Observe.use(props.tag, WorkPoolView.pack);
  const logsR = useAtomValue(bundle.logs);
  if (Route.viewOf(Route.targetOf(nav.match)) !== "logs") return null;
  const logs = AsyncResult.isSuccess(logsR) ? logsR.value : [];
  return (
    <Box flexDirection="column">
      <Text>
        logs · {props.name ?? displayName(props.tag.key)} · Esc back
      </Text>
      <LogTail logs={logs} visible={20} />
    </Box>
  );
};

/**
 * TUI TSX implementations for {@link WorkPoolView} card / detail / page.
 *
 * @public
 */
export const componentsLayer: Layer.Layer<
  WorkPoolView.PoolCard | WorkPoolView.PoolDetail | WorkPoolView.PoolPage
> = Layer.mergeAll(
  View.succeed(WorkPoolView.PoolCard, PoolCardView),
  View.succeed(WorkPoolView.PoolDetail, PoolDetailView),
  View.succeed(WorkPoolView.PoolPage, PoolPageView),
);

/**
 * Fully provided WorkPool View Layer for the TUI (`R = never`) — ready for {@link Views.react}.
 *
 * @public
 */
export const layer = WorkPoolView.layer.pipe(
  Layer.provideMerge(componentsLayer),
  Layer.provideMerge(Views.base),
);

export { PoolCard, PoolDetail, PoolPage } from "../ui/WorkPoolView";

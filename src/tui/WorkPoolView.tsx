/**
 * @module tui/WorkPoolView
 *
 * TUI (Ink) skins for shared {@link WorkPoolView} handles — `View.provide` only.
 */
import { Box, Text } from "ink";
import * as React from "react";
import { Option, Layer } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { useAtomValue } from "../ui/atom-react";
import { isQueueTag, type QueueTag } from "../ui/data";
import * as Router from "../ui/Router";
import * as View from "../ui/View";
import * as Observe from "../Observe";
import * as WorkPoolView from "../ui/WorkPoolView";
import { QueueCell } from "./cellWidgets";
import { LogTail } from "./focusWidgets";
import {
  displayName,
  PageXL,
  type Priority,
  type Status,
  type View as QueueSnapshot,
} from "./queueWidget";

const statusOf = (phase: string, paused: boolean): Status =>
  phase === "off" ? "off" : phase === "draining" ? "draining" : paused ? "paused" : "running";

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
  if (nav.view !== "logs") return null;
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
 * TUI TSX provides for {@link WorkPoolView} card / detail / page.
 *
 * @public
 */
export const skins: Layer.Layer<
  WorkPoolView.PoolCard | WorkPoolView.PoolDetail | WorkPoolView.PoolPage
> = Layer.mergeAll(
  View.provide(WorkPoolView.PoolCard, PoolCardView),
  View.provide(WorkPoolView.PoolDetail, PoolDetailView),
  View.provide(WorkPoolView.PoolPage, PoolPageView),
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

export { PoolCard, PoolDetail, PoolPage } from "../ui/WorkPoolView";

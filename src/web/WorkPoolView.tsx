/**
 * @module web/WorkPoolView
 *
 * Web (DOM) skins for shared {@link WorkPoolView} handles — `Layer.succeed` only.
 */
import { Layer } from "effect";
import { isQueueTag } from "../ui/data";
import * as View from "../ui/View";
import * as WorkPoolView from "../ui/WorkPoolView";
import { displayName, QueueCard, QueueDetailPanel } from "./widgets";

const PoolCardView: View.ViewComponent = (props) => {
  if (!isQueueTag(props.tag)) return null;
  return (
    <QueueCard
      tag={props.tag}
      name={props.name ?? displayName(props.tag.key)}
    />
  );
};

const PoolDetailView: View.ViewComponent = (props) => {
  if (!isQueueTag(props.tag)) return null;
  return <QueueDetailPanel tag={props.tag} />;
};

/**
 * Web TSX provides for {@link WorkPoolView.PoolCard} / {@link WorkPoolView.PoolDetail}.
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
 * Fully provided WorkPool View Layer for the web (`R = never`) — ready for {@link View.react}.
 *
 * @public
 */
export const layer = WorkPoolView.layer.pipe(
  Layer.provideMerge(skins),
  Layer.provideMerge(View.base),
);

export { PoolCard, PoolDetail } from "../ui/WorkPoolView";

/**
 * @module web/WorkPoolView
 *
 * Web (DOM) skins for shared {@link WorkPoolView} handles — {@link View.provide} only.
 */
import { Layer } from "effect";
import { isQueueTag } from "../ui/data";
import * as View from "../ui/View";
import * as WorkPoolView from "../ui/WorkPoolView";
import { displayName, QueueCard, QueueDetailPanel } from "./widgets";

/**
 * Web TSX provides for {@link WorkPoolView.PoolCard} / {@link WorkPoolView.PoolDetail}.
 *
 * @public
 */
export const skins: Layer.Layer<
  WorkPoolView.PoolCard | WorkPoolView.PoolDetail
> = Layer.mergeAll(
  View.provide(WorkPoolView.PoolCard, (props) => {
    if (!isQueueTag(props.tag)) return null;
    return (
      <QueueCard
        tag={props.tag}
        name={props.name ?? displayName(props.tag.key)}
      />
    );
  }),
  View.provide(WorkPoolView.PoolDetail, (props) => {
    if (!isQueueTag(props.tag)) return null;
    return <QueueDetailPanel tag={props.tag} />;
  }),
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

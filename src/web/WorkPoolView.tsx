/**
 * @module web/WorkPoolView
 *
 * Web (DOM) implementations for shared {@link WorkPoolView} handles — {@link View.provide} only.
 */
import { Layer } from "effect";
import { isQueueTag } from "../ui/data";
import * as GroupNav from "../ui/GroupNav";
import * as Route from "../ui/Route";
import * as Router from "../ui/Router";
import * as View from "../ui/View";
import * as WorkPoolView from "../ui/WorkPoolView";
import { LogsPage } from "./resourcePages";
import { displayName, QueueCard, QueueDetailPanel } from "./widgets";

/**
 * Web TSX provides for {@link WorkPoolView.PoolCard} / {@link WorkPoolView.PoolDetail}.
 *
 * @public
 */
export const provides: Layer.Layer<
  WorkPoolView.PoolCard | WorkPoolView.PoolDetail | WorkPoolView.PoolPage
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
  View.provide(WorkPoolView.PoolPage, (props) => {
    if (!isQueueTag(props.tag)) return null;
    const nav = Router.useRouter();
    const target = Route.targetOf(nav.match);
    if (target === undefined || Route.viewOf(target) !== "logs") return null;
    return (
      <LogsPage
        tag={props.tag}
        onClose={() =>
          nav.go(GroupNav.toHref(target.keys.slice(0, -1)), { replace: true })
        }
      />
    );
  }),
);

/**
 * Fully provided WorkPool View Layer for the web (`R = never`) — ready for {@link View.react}.
 *
 * @public
 */
export const layer = WorkPoolView.layer.pipe(
  Layer.provideMerge(provides),
  Layer.provideMerge(View.base),
);

export { PoolCard, PoolDetail, PoolPage } from "../ui/WorkPoolView";

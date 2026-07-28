/**
 * @module ui/PriorityView
 *
 * Shared View handles + contribution Layer — no platform TSX.
 */
import { Layer } from "effect";
import * as WorkPool from "../WorkPool";
import * as View from "./View";

const CardProto = View.Card.Prototype()({
  spec: WorkPool.priorityControlSpec,
});
const DetailProto = View.Detail.Prototype()({
  spec: WorkPool.priorityControlSpec,
});

/** @public */
export class PriorityCard extends CardProto.Tag<PriorityCard>()(
  "hyperlink/view/priority-card",
) {}

/** @public */
export class PriorityDetail extends DetailProto.Tag<PriorityDetail>()(
  "hyperlink/view/priority-detail",
) {}

/** @public */
export const layer = Layer.mergeAll(
  View.bind(WorkPool.priorityKind, PriorityCard),
  View.bind(WorkPool.priorityKind, PriorityDetail),
);

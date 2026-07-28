/**
 * @module ui/PriorityView
 *
 * Shared View handles + contribution Layer — no platform TSX.
 */
import { Layer } from "effect";
import * as WorkPool from "../WorkPool";
import * as View from "./View";

/** @public */
export class PriorityCard extends View.Card.Tag<PriorityCard>()(
  "hyperlink/view/priority-card",
  { spec: WorkPool.priorityControlSpec },
) {}

/** @public */
export class PriorityDetail extends View.Detail.Tag<PriorityDetail>()(
  "hyperlink/view/priority-detail",
  { spec: WorkPool.priorityControlSpec },
) {}

/** @public */
export const layer = Layer.mergeAll(
  View.bind(WorkPool.priorityKind, PriorityCard),
  View.bind(WorkPool.priorityKind, PriorityDetail),
);

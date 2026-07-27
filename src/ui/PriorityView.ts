/**
 * @module ui/PriorityView
 *
 * Shared WorkPool.priority View handles + contribution Layer — no platform TSX.
 */
import { Layer } from "effect";
import * as WorkPool from "../WorkPool";
import * as View from "./View";

/** @public */
export class PriorityCard extends View.Tag<PriorityCard>()(
  "hyperlink/view/priority-card",
  "card",
  WorkPool.priorityControlSpec,
) {}

/** @public */
export class PriorityDetail extends View.Tag<PriorityDetail>()(
  "hyperlink/view/priority-detail",
  "detail",
  WorkPool.priorityControlSpec,
) {}

/** @public */
export const layer = Layer.mergeAll(
  View.bind(WorkPool.priorityKind, PriorityCard),
  View.bind(WorkPool.priorityKind, PriorityDetail),
);

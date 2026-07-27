/**
 * @module ui/PriorityView
 *
 * Shared WorkPool.priority View handles + contribution Layer — no platform TSX.
 */
import { Layer } from "effect";
import * as WorkPool from "../WorkPool";
import * as View from "./View";

/** @public */
export const PriorityCard = View.make({
  key: "hyperlink/view/priority-card",
  kind: "card",
  spec: WorkPool.priorityControlSpec,
});

/** @public */
export const PriorityDetail = View.make({
  key: "hyperlink/view/priority-detail",
  kind: "detail",
  spec: WorkPool.priorityControlSpec,
});

/** @public */
export const layer = Layer.mergeAll(
  View.kind(WorkPool.priorityKind, PriorityCard),
  View.kind(WorkPool.priorityKind, PriorityDetail),
);

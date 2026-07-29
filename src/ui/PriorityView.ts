/**
 * @module ui/PriorityView
 *
 * Shared View handles + contribution Layer + observe **pack** — no platform TSX.
 *
 * @example
 * ```ts
 * import * as Observe from "hyperlink-ts/Observe"
 * import * as PriorityView from "hyperlink-ts/ui/PriorityView"
 * const box = Observe.use(Jobs, PriorityView.pack)
 * ```
 */
import { Layer } from "effect";
import * as WorkPool from "../WorkPool";
import { priorityPack as pack } from "./familyPacks";
import * as View from "./View";

export { pack };

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

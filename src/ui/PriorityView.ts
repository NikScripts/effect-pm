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
import { pack } from "./priorityViewPack";
import * as Views from "./Views";
export { pack };

/** @public */
export class PriorityCard extends Views.Card.Tag<PriorityCard>()(
  "hyperlink/view/priority-card",
  { spec: WorkPool.priorityControlSpec },
) {}

/** @public */
export class PriorityDetail extends Views.Detail.Tag<PriorityDetail>()(
  "hyperlink/view/priority-detail",
  { spec: WorkPool.priorityControlSpec },
) {}

/** @public */
export const layer = Layer.mergeAll(
  Views.bind(WorkPool.priorityKind, PriorityCard),
  Views.bind(WorkPool.priorityKind, PriorityDetail),
);

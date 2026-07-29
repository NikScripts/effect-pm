/**
 * @module ui/WorkPoolView
 *
 * Shared WorkPool View **handles** + contribution Layer + observe **pack** — no platform TSX.
 * Provide skins with `View.provide` in `web/WorkPoolView` / `tui/WorkPoolView`.
 *
 * @example
 * ```ts
 * import * as Observe from "hyperlink-ts/Observe"
 * import * as WorkPoolView from "hyperlink-ts/ui/WorkPoolView"
 *
 * const box = Observe.use(Jobs, WorkPoolView.pack)
 * ```
 */
import { Layer } from "effect";
import * as WorkPool from "../WorkPool";
import * as View from "./View";

export { pack, queueControls, queueMetricsHistory } from "./workPoolViewPack";

/**
 * Default WorkPool card View service.
 *
 * @public
 */
export class PoolCard extends View.Card.Tag<PoolCard>()(
  "hyperlink/view/pool-card",
  { spec: WorkPool.queueControlSpec },
) {}

/**
 * Default WorkPool detail View service.
 *
 * @public
 */
export class PoolDetail extends View.Detail.Tag<PoolDetail>()(
  "hyperlink/view/pool-detail",
  { spec: WorkPool.queueControlSpec },
) {}

/**
 * Contribution Layer: stamped {@link WorkPool.kind} → card + detail (append).
 * Merge with platform skins + {@link View.base}, then {@link View.react}.
 *
 * @public
 */
export const layer = Layer.mergeAll(
  View.bind(WorkPool.kind, PoolCard),
  View.bind(WorkPool.kind, PoolDetail),
);

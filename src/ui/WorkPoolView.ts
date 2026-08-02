/**
 * @module ui/WorkPoolView
 *
 * Shared WorkPool View **handles** + contribution Layer + observe **pack** — no platform TSX.
 * Provide implementations with `View.provide` in `web/WorkPoolView` / `tui/WorkPoolView`.
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
import * as Views from "./Views";
export {
  pack,
  queueControls,
  queueLogs,
  queueMetricsHistory,
  serviceLogs,
} from "./workPoolViewPack";

/**
 * Default WorkPool card View service.
 *
 * @public
 */
export class PoolCard extends Views.Card.Tag<PoolCard>()(
  "hyperlink/view/pool-card",
  { spec: WorkPool.queueControlSpec },
) {}

/**
 * Default WorkPool detail View service.
 *
 * @public
 */
export class PoolDetail extends Views.Detail.Tag<PoolDetail>()(
  "hyperlink/view/pool-detail",
  { spec: WorkPool.queueControlSpec },
) {}

/**
 * Default WorkPool page View service — logs fullscreen (`/…/logs`).
 *
 * @public
 */
export class PoolPage extends Views.Page.Tag<PoolPage>()(
  "hyperlink/view/pool-page",
  { spec: WorkPool.queueControlSpec },
) {}

/**
 * Contribution Layer: stamped {@link WorkPool.kind} → card + detail + page (append).
 * Merge with platform provides + {@link Views.base}, then {@link Views.react}.
 *
 * @public
 */
export const layer = Layer.mergeAll(
  Views.bind(WorkPool.kind, PoolCard),
  Views.bind(WorkPool.kind, PoolDetail),
  Views.bind(WorkPool.kind, PoolPage),
);

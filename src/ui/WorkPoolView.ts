/**
 * @module ui/WorkPoolView
 *
 * Shared WorkPool View **handles** + contribution Layer — no platform TSX.
 * Provide skins with `Layer.succeed` in `web/WorkPoolView` / `tui/WorkPoolView`.
 *
 * @example
 * ```ts
 * import * as WorkPoolView from "hyperlink-ts/ui/WorkPoolView"
 * import * as WebWorkPoolView from "hyperlink-ts/web/WorkPoolView"
 *
 * const ready = WorkPoolView.layer.pipe(
 *   Layer.provideMerge(WebWorkPoolView.skins),
 *   Layer.provideMerge(View.base),
 * )
 * const kit = View.react(ready)
 * ```
 */
import { Layer } from "effect";
import * as WorkPool from "../WorkPool";
import * as View from "./View";

/**
 * Default WorkPool card View service.
 *
 * @public
 */
export const PoolCard = View.make({
  key: "hyperlink/view/pool-card",
  kind: "card",
  spec: WorkPool.queueControlSpec,
});

/**
 * Default WorkPool detail View service.
 *
 * @public
 */
export const PoolDetail = View.make({
  key: "hyperlink/view/pool-detail",
  kind: "detail",
  spec: WorkPool.queueControlSpec,
});

/**
 * Contribution Layer: stamped {@link WorkPool.kind} → card + detail (append).
 * Merge with platform skins + {@link View.base}, then {@link View.react}.
 *
 * @public
 */
export const layer = Layer.mergeAll(
  View.kind(WorkPool.kind, PoolCard),
  View.kind(WorkPool.kind, PoolDetail),
);

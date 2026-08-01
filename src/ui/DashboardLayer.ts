/**
 * @module ui/DashboardLayer
 *
 * Effect Layer spine for batteries Dashboard compose — family contributions, then
 * `provideMerge` platform implementations + {@link View.base}. Compose with `pipe` /
 * {@link provide}; do not pass Layers in an options object.
 *
 * @example
 * ```ts
 * import { Layer } from "effect"
 * import * as DashboardLayer from "hyperlink-ts/ui/DashboardLayer"
 * import * as WebDashboardViews from "hyperlink-ts/web/DashboardViews"
 *
 * const views = Layer.mergeAll(DashboardLayer.layer, appViews).pipe(
 *   DashboardLayer.provide(WebDashboardViews.provides),
 * )
 * // no app contributions: WebDashboardViews.layer
 *
 * const ui = View.compose({
 *   views,
 *   router: Router.history(site),
 *   group: ServicesHub,
 * })
 * ```
 */
import { Layer } from "effect";
import { dual } from "effect/Function";
import * as DashboardViews from "./DashboardViews";
import * as View from "./View";

/**
 * Family View contributions (binds / only). Merge app contrib with
 * `Layer.mergeAll(DashboardLayer.layer, appViews)` before {@link provide}.
 *
 * @public
 */
export const layer: typeof DashboardViews.layer = DashboardViews.layer;

/**
 * `provideMerge` View Tag implementations, then {@link View.base}.
 *
 * @example
 * ```ts
 * Layer.mergeAll(DashboardLayer.layer, appViews).pipe(
 *   DashboardLayer.provide(WebDashboardViews.provides),
 * )
 * DashboardLayer.provide(views, WebDashboardViews.provides)
 * ```
 *
 * @public
 */
export const provide = dual(
  2,
  <A2, E2, R2, A, E, R>(
    self: Layer.Layer<A2, E2, R2>,
    provides: Layer.Layer<A, E, R>,
  ) =>
    self.pipe(Layer.provideMerge(provides), Layer.provideMerge(View.base)),
);

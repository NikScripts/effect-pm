/**
 * @module ui/DashboardLayer
 *
 * Family View **contributions** for batteries Dashboard (`View.bind` / `only`).
 * Compose with platform `componentsLayer` via ordinary Effect Layer combinators —
 * there is no Domain.provide helper.
 *
 * @example
 * ```ts
 * import { Layer } from "effect"
 * import * as DashboardLayer from "hyperlink-ts/ui/DashboardLayer"
 * import * as View from "hyperlink-ts/ui/View"
 * import * as WebDashboardViews from "hyperlink-ts/web/DashboardViews"
 *
 * const views = Layer.mergeAll(DashboardLayer.layer, appViews).pipe(
 *   Layer.provideMerge(WebDashboardViews.componentsLayer),
 *   Layer.provideMerge(View.base),
 * )
 * // no app contributions: WebDashboardViews.layer
 * ```
 */
export { layer } from "./DashboardViews";

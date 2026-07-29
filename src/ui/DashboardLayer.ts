/**
 * @module ui/DashboardLayer
 *
 * Effect Layer recipe for batteries Dashboard compose — family contributions + optional
 * app views, provided with platform skins and {@link View.base}. Platform shells
 * (`web/DashboardShell`, `tui/DashboardShell`) sit above {@link View.compose}; this module
 * is only the Layer spine (no DOM / Ink).
 *
 * @example
 * ```ts
 * import * as DashboardLayer from "hyperlink-ts/ui/DashboardLayer"
 * import * as WebDashboardViews from "hyperlink-ts/web/DashboardViews"
 *
 * const ui = View.compose({
 *   views: DashboardLayer.forCompose({
 *     skins: WebDashboardViews.skins,
 *     views: appViews,
 *   }),
 *   navigator: Navigator.history(ServicesHub),
 * })
 * ```
 */
import { Layer } from "effect";
import * as DashboardViews from "./DashboardViews";
import * as View from "./View";

/**
 * Merge Dashboard family contributions (+ optional app views) with platform skins and
 * {@link View.base} — ready for {@link View.compose}`({ views })`.
 *
 * @public
 */
export const forCompose = <A, E, R>(options: {
  /** Platform `View.provide` skins (web or TUI). */
  readonly skins: Layer.Layer<A, E, R>;
  /** App View contributions (`View.only` / custom families). */
  readonly views?: Layer.Layer<never, never, View.Registry>;
}) =>
  Layer.mergeAll(DashboardViews.layer, options.views ?? Layer.empty).pipe(
    Layer.provideMerge(options.skins),
    Layer.provideMerge(View.base),
  );

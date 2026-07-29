/**
 * @module web/Dashboard
 *
 * The batteries-included resource dashboard: point it at a reactive `runtime` (an
 * `Atom.runtime(layer)` over your tags — local engine or `Hyperlink.client` over http) and a
 * root `Group`, and it renders the responsive drill-down. Navigation is URL-backed and
 * animated with view transitions.
 *
 * Stack (Effect-shaped): {@link ../ui/DashboardLayer.forCompose} → {@link ../ui/View.compose}
 * → {@link ./DashboardShell}. Public kit one-liner — thin wiring over that stack.
 *
 * Use `<Dashboard runtime group />` for the one-liner, or compose `DashboardView` /
 * `DashboardLayer.forCompose` + `View.compose` + `DashboardShell` yourself.
 */
import * as React from "react";
import { Layer } from "effect";
import {
  type DashboardRuntime,
  type GroupNode,
} from "../ui/data";
import * as DashboardLayer from "../ui/DashboardLayer";
import { RegistryProvider } from "../ui/atom-react";
import { RuntimeProvider } from "./runtime";
import { ViewTransitionProvider } from "./useViewTransition";
import { base } from "./widgets";
import { type WidgetRegistry } from "../ui/widgetRegistry";
import * as Navigator from "../ui/Navigator";
import * as View from "../ui/View";
import { WidgetsProvider } from "../ui/widgetsContext";
import type { Widget } from "./widget-registry";
import { DebugConsole } from "./debug-console";
import * as WebDashboardViews from "./DashboardViews";
import { DashboardShell } from "./DashboardShell";

/**
 * The drill-down view + its runtime — compose with `RegistryProvider` + `ViewTransitionProvider`
 * yourself, or use `<Dashboard>` which wires all three.
 *
 * @public
 */
export const DashboardView = <R, ER>(props: {
  readonly runtime: DashboardRuntime<R, ER>;
  readonly group: GroupNode;
  /**
   * App View contributions (`R = View.Registry`). Prefer
   * `View.only(Tag, Card).pipe(Layer.provide(View.provide(Card, Comp)))`.
   * Merged with shipped family contributions, then skins + {@link View.base}.
   */
  readonly views?: Layer.Layer<never, never, View.Registry>;
}): React.ReactElement => {
  const ui = React.useMemo(
    () =>
      View.compose({
        views: DashboardLayer.forCompose({
          skins: WebDashboardViews.skins,
          views: props.views,
        }),
        navigator: Navigator.history(props.group),
      }),
    [props.group, props.views],
  );
  return (
    <ui.Provider>
      <RuntimeProvider runtime={props.runtime}>
        <div className="font-mono">
          <DashboardShell group={props.group} />
        </div>
      </RuntimeProvider>
    </ui.Provider>
  );
};

/**
 * Batteries-included dashboard: providers + the responsive view + the (opt-in) debug console.
 * `<Dashboard runtime={Atom.runtime(layer)} group={ServicesHub} views={appViews} />`.
 *
 * @public
 */
export const Dashboard = <R, ER>(props: {
  readonly runtime: DashboardRuntime<R, ER>;
  readonly group: GroupNode;
  /** App View contributions — see {@link DashboardView} `views`. */
  readonly views?: Layer.Layer<never, never, View.Registry>;
  /** Legacy widget registry fallback only. Prefer {@link views}. */
  readonly widgets?: WidgetRegistry<Widget>;
}): React.ReactElement => (
  <RegistryProvider>
    <WidgetsProvider registry={props.widgets ?? base}>
      <ViewTransitionProvider>
        <DashboardView
          runtime={props.runtime}
          group={props.group}
          views={props.views}
        />
        <DebugConsole />
      </ViewTransitionProvider>
    </WidgetsProvider>
  </RegistryProvider>
);

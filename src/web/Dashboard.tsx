/**
 * @module web/Dashboard
 *
 * The batteries-included resource dashboard: point it at a reactive `runtime` (an
 * `Atom.runtime(layer)` over your tags — local engine or `Hyperlink.client` over http) and a
 * root `Group`, and it renders the responsive drill-down. Navigation is URL-backed and
 * animated with view transitions.
 *
 * Stack (Effect-shaped): `DashboardViews.layer` (shared contributions) →
 * `Layer.provideMerge(componentsLayer)` → {@link View.base} →
 * {@link ../ui/View.compose} → {@link ./DashboardShell}.
 *
 * Use `<Dashboard runtime group />`, or pipe Layers + `View.compose` + `DashboardShell`.
 * Ready platform Layer without app contrib: {@link layer}.
 */
import * as React from "react";
import { Layer } from "effect";
import {
  type DashboardRuntime,
  type GroupNode,
} from "../ui/data";
import * as DashboardViews from "../ui/DashboardViews";
import { RegistryProvider } from "../ui/atom-react";
import { RuntimeProvider } from "./runtime";
import { ViewTransitionProvider } from "./useViewTransition";
import { base } from "./widgets";
import { type WidgetRegistry } from "../ui/widgetRegistry";
import * as Group from "../Group";
import * as Route from "../ui/Route";
import * as Router from "../ui/Router";
import * as View from "../ui/View";
import { WidgetsProvider } from "../ui/widgetsContext";
import type { Widget } from "./widget-registry";
import { DebugConsole } from "./debug-console";
import { DashboardShell } from "./DashboardShell";
import {
  componentsLayer,
  layer as readyLayer,
} from "../internal/webDashboardComponents";

export { componentsLayer } from "../internal/webDashboardComponents";

/**
 * Fully provided web Dashboard View Layer (`R = never`) — contributions +
 * {@link componentsLayer} + {@link View.base}. Ready for {@link View.react}.
 *
 * @public
 */
export const layer: typeof readyLayer = readyLayer;

const routesFor = (group: GroupNode) =>
  Route.make("dashboard").add(
    Route.group("hub", { topLevel: true }).fromEffect(Group.asRoutes(group)),
  );

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
   * Merged with shipped family contributions, then {@link componentsLayer} +
   * {@link View.base}.
   */
  readonly views?: Layer.Layer<never, never, View.Registry>;
}): React.ReactElement => {
  const ui = React.useMemo(() => {
    const views = Layer.mergeAll(
      DashboardViews.layer,
      props.views ?? Layer.empty,
    ).pipe(
      Layer.provideMerge(componentsLayer),
      Layer.provideMerge(View.base),
    );
    return View.compose({
      views,
      router: Router.history(routesFor(props.group)),
      group: props.group,
    });
  }, [props.group, props.views]);
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

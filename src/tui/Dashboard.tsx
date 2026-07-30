/**
 * @module tui/Dashboard
 *
 * The Ink Group dashboard — terminal counterpart to `<Dashboard runtime group />` from
 * `hyperlink-ts/web`. Stack: {@link ../ui/DashboardLayer.forCompose} → {@link ../ui/View.compose}
 * → {@link ./DashboardShell}. Public kit one-liner.
 *
 * ```tsx
 * <Dashboard runtime={Atom.runtime(appLayer)} group={Fleet} />
 * <Dashboard runtime={runtime} group={Fleet} path={["Mail"]} />
 * ```
 *
 *   ↑↓←→ / hjkl  move · Enter/Space open or drill · Esc/Backspace back/up
 *   mouse  wheel scrolls, click selects, click again opens
 *   :  command bar · Ctrl+E edit mode · Ctrl+C quit
 *
 */
import * as React from "react";
import { Layer } from "effect";
import {
  type DashboardRuntime,
  type GroupNode,
} from "../ui/data";
import * as DashboardLayer from "../ui/DashboardLayer";
import { RegistryProvider } from "../ui/atom-react";
import * as Group from "../Group";
import * as GroupNav from "../ui/GroupNav";
import * as Route from "../ui/Route";
import * as Router from "../ui/Router";
import * as View from "../ui/View";
import { WidgetsProvider } from "../ui/widgetsContext";
import { base, type TuiWidgetRegistry } from "./cellWidgets";
import * as TuiDashboardViews from "./DashboardViews";
import { RuntimeProvider } from "./runtime";
import { DashboardShell } from "./DashboardShell";

const routesFor = (group: GroupNode) =>
  Route.make("dashboard").add(
    Route.group("hub", { topLevel: true }).fromEffect(Group.asRoutes(group)),
  );

/**
 * Batteries-included terminal dashboard: registry + Group drill-down.
 * `<Dashboard runtime={Atom.runtime(layer)} group={Fleet} />`.
 *
 * @public
 */
export const Dashboard = <R, ER>(props: {
  readonly runtime: DashboardRuntime<R, ER>;
  readonly group: GroupNode;
  /** CLI / deep-link focus as member-key nicknames (`["Inbox"]`, `["Mini", "KeyRotation"]`). */
  readonly path?: ReadonlyArray<string>;
  /**
   * App View contributions (`R = View.Registry`). Prefer
   * `View.only(Tag, Card).pipe(Layer.provide(Layer.succeed(Card, Comp)))`.
   */
  readonly views?: Layer.Layer<never, never, View.Registry>;
  /** Legacy widget registry fallback only. Prefer {@link views}. */
  readonly widgets?: TuiWidgetRegistry;
}): React.ReactElement => {
  const ui = React.useMemo(() => {
    const composed = View.compose({
      views: DashboardLayer.forCompose({
        skins: TuiDashboardViews.skins,
        views: props.views,
      }),
      router: Router.memory(routesFor(props.group)),
      group: props.group,
    });
    for (const key of props.path ?? []) {
      GroupNav.openKey(props.group, composed.router, key);
    }
    return composed;
  }, [props.group, props.views, props.path]);

  return (
    <RegistryProvider>
      <ui.Provider>
        <WidgetsProvider registry={props.widgets ?? base}>
          <RuntimeProvider runtime={props.runtime}>
            <DashboardShell group={props.group} />
          </RuntimeProvider>
        </WidgetsProvider>
      </ui.Provider>
    </RegistryProvider>
  );
};

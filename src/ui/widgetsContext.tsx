/**
 * @module ui/widgetsContext
 *
 * React context for a {@link WidgetRegistry}. `<Dashboard>` (web or TUI) provides it so deep
 * cells can resolve chrome without prop-drilling the registry.
 *
 */
import * as React from "react";
import type { WidgetRegistry } from "./widgetRegistry";

const WidgetsContext = React.createContext<WidgetRegistry<unknown> | null>(null);

/** Provide the widget registry to the dashboard subtree. @public */
export const WidgetsProvider = <W,>(props: {
  readonly registry: WidgetRegistry<W>;
  readonly children: React.ReactNode;
}): React.ReactElement =>
  React.createElement(
    WidgetsContext.Provider,
    { value: props.registry as WidgetRegistry<unknown> },
    props.children,
  );

/** The widget registry from context (throws if no `WidgetsProvider` / `<Dashboard>` above). @public */
export const useWidgets = <W,>(): WidgetRegistry<W> => {
  const reg = React.useContext(WidgetsContext);
  if (reg === null) {
    throw new Error("useWidgets: render inside <WidgetsProvider> (or use <Dashboard>)");
  }
  return reg as WidgetRegistry<W>;
};

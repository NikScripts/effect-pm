/**
 * Styled ops dashboard components built on `@nikscripts/effect-pm/react`.
 *
 * @packageDocumentation
 * @module ops-ui
 */

export { OperatorDashboard } from "./OperatorDashboard.js";
export type { OperatorDashboardProps } from "./OperatorDashboard.js";
export { ProcessStatusTable, QueueStatusTable } from "./StatusTables.js";
export type { ProcessStatusTableProps, QueueStatusTableProps } from "./StatusTables.js";
export { LogViewer } from "./LogViewer.js";
export type { LogViewerProps } from "./LogViewer.js";
export {
  defaultDashboardLayout,
  parseDashboardLayout,
  resizeGridWidget,
  useDashboardLayout,
} from "./dashboardLayout.js";
export type {
  BarWidgetPlacement,
  DashboardBarLayout,
  DashboardLayout,
  DashboardLayoutChange,
  DashboardLayoutState,
  DashboardWidgetKind,
  DashboardWidgetId,
  WidgetLayout,
  UseDashboardLayoutOptions,
} from "./dashboardLayout.js";

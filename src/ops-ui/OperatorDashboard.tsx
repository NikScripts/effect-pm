/**
 * Styled operator dashboard shell for effect-pm controls and logs.
 *
 * @module ops-ui/OperatorDashboard
 */

import { useState, type ReactNode } from "react";
import {
  ControlPlaneProvider,
  Controls,
  useControlPlaneGroupStatus,
  type ControlPlanePort,
  type DashboardGroupTarget,
  type DashboardProcessTarget,
  type DashboardQueueTarget,
} from "../react/index.js";
import {
  moveGridWidget,
  resizeGridWidget,
  useDashboardLayout,
  type DashboardLayout,
  type DashboardLayoutChange,
  type DashboardWidgetKind,
  type GridWidgetPlacement,
} from "./dashboardLayout.js";
import { LogViewer } from "./LogViewer.js";
import { ProcessStatusTable, QueueStatusTable } from "./StatusTables.js";

export type OperatorDashboardProps = {
  readonly port: ControlPlanePort;
  readonly for: DashboardGroupTarget;
  readonly processes?: ReadonlyArray<DashboardProcessTarget>;
  readonly queues?: ReadonlyArray<DashboardQueueTarget>;
  readonly pollIntervalMs?: number;
  readonly logLines?: number;
  readonly title?: ReactNode;
  readonly description?: ReactNode;
  readonly className?: string;
  readonly layout?: DashboardLayout;
  readonly layoutStorageKey?: string;
  readonly onLayoutChange?: DashboardLayoutChange;
};

const dashboardClassName = (className: string | undefined): string =>
  className === undefined || className.length === 0
    ? "pm-dashboard"
    : `pm-dashboard ${className}`;

type OperatorDashboardContentProps = Omit<OperatorDashboardProps, "port">;

const widgetTitle = (widget: DashboardWidgetKind): string => {
  switch (widget) {
    case "status-table":
      return "Processes and queues";
    case "logs":
      return "Streaming tail";
    case "process-controls":
      return "Selected process controls";
    case "queue-controls":
      return "Selected queue controls";
  }
};

const widgetLabel = (widget: DashboardWidgetKind): string => {
  switch (widget) {
    case "status-table":
      return "Group status";
    case "logs":
      return "Live logs";
    case "process-controls":
      return "Scoped processes";
    case "queue-controls":
      return "Scoped queues";
  }
};

const gridStyle = (placement: GridWidgetPlacement) => ({
  gridColumn: `${String(placement.x + 1)} / span ${String(placement.w)}`,
  gridRow: `span ${String(placement.h)}`,
});

const layoutColumns = "repeat(12, minmax(0, 1fr))";

type WidgetFrameProps = {
  readonly placement: GridWidgetPlacement;
  readonly editMode: boolean;
  readonly children: ReactNode;
  readonly onMove: (direction: "up" | "down") => void;
  readonly onResize: (delta: { readonly w?: number; readonly h?: number }) => void;
};

const WidgetFrame = ({
  placement,
  editMode,
  children,
  onMove,
  onResize,
}: WidgetFrameProps) => (
  <article
    className="pm-dashboard__card pm-dashboard__grid-widget"
    data-pm-widget={placement.widget}
    style={gridStyle(placement)}
  >
    <div className="pm-dashboard__card-header pm-dashboard__widget-header">
      <div>
        <p className="pm-dashboard__section-label">{widgetLabel(placement.widget)}</p>
        <h2>{widgetTitle(placement.widget)}</h2>
      </div>
      {editMode ? (
        <div className="pm-dashboard__widget-edit" aria-label={`${placement.id} layout controls`}>
          <button type="button" onClick={() => onMove("up")}>Up</button>
          <button type="button" onClick={() => onMove("down")}>Down</button>
          <button type="button" onClick={() => onResize({ w: -1 })}>Narrow</button>
          <button type="button" onClick={() => onResize({ w: 1 })}>Wide</button>
          <button type="button" onClick={() => onResize({ h: -1 })}>Short</button>
          <button type="button" onClick={() => onResize({ h: 1 })}>Tall</button>
        </div>
      ) : null}
    </div>
    {children}
  </article>
);

const OperatorDashboardContent = ({
  for: group,
  processes = [],
  queues = [],
  pollIntervalMs = 2000,
  logLines = 80,
  title = "effect-pm ops",
  description = "Live controls and logs for a process group.",
  className,
  layout,
  layoutStorageKey,
  onLayoutChange,
}: OperatorDashboardContentProps) => {
  const status = useControlPlaneGroupStatus({ pollIntervalMs });
  const processIds = processes.map((process) => process.id);
  const queueIds = queues.map((queue) => queue.id);
  const [editMode, setEditMode] = useState(false);
  const dashboardLayout = useDashboardLayout({ layout, layoutStorageKey, onLayoutChange });

  const updatePlacement = (update: (layout: DashboardLayout) => DashboardLayout) => {
    dashboardLayout.setLayout(update);
  };

  const renderWidget = (placement: GridWidgetPlacement): ReactNode => {
    switch (placement.widget) {
      case "status-table":
        return (
          <div className="pm-dashboard__table-stack">
            <ProcessStatusTable status={status} />
            <QueueStatusTable status={status} />
          </div>
        );
      case "logs":
        return (
          <LogViewer
            for={group}
            processes={processes}
            queues={queues}
            lines={logLines === 50 || logLines === 100 || logLines === 250 ? logLines : 100}
          />
        );
      case "process-controls":
        return processes.length > 0 ? (
          <>
            <ProcessStatusTable status={status} processIds={processIds} />
            {processes.map((process) => (
              <Controls
                for={process}
                key={process.id}
                pollIntervalMs={pollIntervalMs}
                sharedStatus={status}
              />
            ))}
          </>
        ) : <p>No process targets configured.</p>;
      case "queue-controls":
        return queues.length > 0 ? (
          <>
            <QueueStatusTable status={status} queueIds={queueIds} />
            {queues.map((queue) => (
              <Controls
                for={queue}
                key={queue.id}
                pollIntervalMs={pollIntervalMs}
                sharedStatus={status}
              />
            ))}
          </>
        ) : <p>No queue targets configured.</p>;
    }
  };

  return (
    <main className={dashboardClassName(className)} data-pm-ops-ui="dashboard">
      <header className="pm-dashboard__hero">
        <div>
          <p className="pm-dashboard__eyebrow">Operator console</p>
          <h1 className="pm-dashboard__title">{title}</h1>
          <p className="pm-dashboard__description">{description}</p>
        </div>
        <div className="pm-dashboard__group-pill">
          <span>Group</span>
          <code>{group.id}</code>
        </div>
      </header>

      <div className="pm-dashboard__toolbar" aria-label="Dashboard layout toolbar">
        <button type="button" onClick={() => setEditMode((value) => !value)}>
          {editMode ? "Done" : "Edit layout"}
        </button>
        <button type="button" onClick={dashboardLayout.resetLayout}>Reset layout</button>
        <span>{editMode ? "Use controls on cards to resize or reorder." : "Layout persisted locally when configured."}</span>
      </div>

      <section
        className="pm-dashboard__layout-grid"
        style={{ gridTemplateColumns: layoutColumns }}
        aria-label="Dashboard widgets"
      >
        {dashboardLayout.layout.grid.map((placement) => (
          <WidgetFrame
            editMode={editMode}
            key={placement.id}
            onMove={(direction) => updatePlacement(
              (current) => moveGridWidget(current, placement.id, direction),
            )}
            onResize={(delta) => updatePlacement(
              (current) => resizeGridWidget(current, placement.id, delta),
            )}
            placement={placement}
          >
            {renderWidget(placement)}
          </WidgetFrame>
        ))}
      </section>
    </main>
  );
};

/**
 * Production-ready shell around the headless React controls/logs primitives.
 *
 * @public
 */
export const OperatorDashboard = ({ port, ...props }: OperatorDashboardProps) => (
  <ControlPlaneProvider port={port}>
    <OperatorDashboardContent {...props} />
  </ControlPlaneProvider>
);

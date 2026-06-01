/**
 * Styled operator dashboard shell for effect-pm controls and logs.
 *
 * @module ops-ui/OperatorDashboard
 */
// @effect-diagnostics globalThis:off globalThisInEffect:off — custom resize handles are browser pointer interactions.

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useState, type MouseEvent, type ReactNode } from "react";
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
  clampWidgetSpan,
  dashboardWidgetKinds,
  reorderDashboardLayout,
  resizeGridWidget,
  sortedDashboardWidgetIds,
  useDashboardLayout,
  type DashboardLayout,
  type DashboardLayoutChange,
  type DashboardWidgetId,
  type DashboardWidgetKind,
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

type WidgetFrameProps = {
  readonly id: DashboardWidgetId;
  readonly widget: DashboardWidgetKind;
  readonly colSpan: number;
  readonly resizing: boolean;
  readonly children: ReactNode;
  readonly onResizeStart: (edge: "left" | "right", event: MouseEvent<HTMLDivElement>) => void;
};

const WidgetFrame = ({
  id,
  widget,
  colSpan,
  resizing,
  children,
  onResizeStart,
}: WidgetFrameProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const style = {
    gridColumn: `span ${String(colSpan)}`,
    minWidth: `${String(colSpan * 75)}px`,
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <article
      className="pm-dashboard__card pm-dashboard__grid-widget"
      data-dragging={isDragging ? "true" : "false"}
      data-pm-widget={widget}
      data-resizing={resizing ? "true" : "false"}
      ref={setNodeRef}
      style={style}
    >
      <div
        className="pm-dashboard__drag-handle"
        title={`Drag to reorder ${id} widget`}
        {...attributes}
        {...listeners}
      />
      <div
        aria-hidden="true"
        className="pm-dashboard__resize-handle pm-dashboard__resize-handle--left"
        onMouseDown={(event) => onResizeStart("left", event)}
      />
      <div
        aria-hidden="true"
        className="pm-dashboard__resize-handle pm-dashboard__resize-handle--right"
        onMouseDown={(event) => onResizeStart("right", event)}
      />
      <div className="pm-dashboard__card-header pm-dashboard__widget-header">
        <div>
          <p className="pm-dashboard__section-label">{widgetLabel(widget)}</p>
          <h2>{widgetTitle(widget)}</h2>
        </div>
      </div>
      {children}
      {isDragging ? <div className="pm-dashboard__drag-indicator" /> : null}
      {resizing ? <div className="pm-dashboard__resize-indicator" /> : null}
    </article>
  );
};

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
  const [resizingId, setResizingId] = useState<DashboardWidgetId | null>(null);
  const dashboardLayout = useDashboardLayout({ layout, layoutStorageKey, onLayoutChange });
  const orderedWidgetIds = sortedDashboardWidgetIds(dashboardLayout.layout);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const startResize = (
    id: DashboardWidgetId,
    edge: "left" | "right",
    event: MouseEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const ordered = sortedDashboardWidgetIds(dashboardLayout.layout);
    const index = ordered.indexOf(id);
    const previousId = index > 0 ? ordered[index - 1] : undefined;
    const startSpan = dashboardLayout.layout[id].colSpan;
    const previousStartSpan = previousId === undefined
      ? undefined
      : dashboardLayout.layout[previousId].colSpan;
    setResizingId(id);

    const onMove = (moveEvent: globalThis.MouseEvent) => {
      const columnDelta = Math.round((moveEvent.clientX - startX) / 100);
      dashboardLayout.setLayout((current) => {
        if (edge === "right" || previousId === undefined || previousStartSpan === undefined) {
          return resizeGridWidget(current, id, startSpan + columnDelta);
        }
        const nextCurrentSpan = clampWidgetSpan(id, startSpan - columnDelta);
        const actualCurrentDelta = startSpan - nextCurrentSpan;
        const nextPreviousSpan = clampWidgetSpan(previousId, previousStartSpan + actualCurrentDelta);
        const actualPreviousDelta = nextPreviousSpan - previousStartSpan;
        return resizeGridWidget(
          resizeGridWidget(current, previousId, nextPreviousSpan),
          id,
          startSpan - actualPreviousDelta,
        );
      });
    };

    const onUp = () => {
      setResizingId(null);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const overId = event.over?.id;
    if (typeof event.active.id === "string" && typeof overId === "string") {
      dashboardLayout.setLayout((current) =>
        reorderDashboardLayout(
          current,
          event.active.id as DashboardWidgetId,
          overId as DashboardWidgetId,
        ),
      );
    }
  };

  const renderWidget = (id: DashboardWidgetId): ReactNode => {
    switch (dashboardWidgetKinds[id]) {
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
        <button type="button" onClick={dashboardLayout.resetLayout}>Reset layout</button>
        <span>Drag cards by their top edge. Resize from the left or right edge.</span>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={[...orderedWidgetIds]} strategy={rectSortingStrategy}>
          <section className="pm-dashboard__layout-grid" aria-label="Dashboard widgets">
            {orderedWidgetIds.map((id) => (
              <WidgetFrame
                colSpan={dashboardLayout.layout[id].colSpan}
                id={id}
                key={id}
                onResizeStart={(edge, event) => startResize(id, edge, event)}
                resizing={resizingId === id}
                widget={dashboardWidgetKinds[id]}
              >
                {renderWidget(id)}
              </WidgetFrame>
            ))}
          </section>
        </SortableContext>
      </DndContext>
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

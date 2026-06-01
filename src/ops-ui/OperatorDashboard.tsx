/**
 * Styled operator dashboard shell for effect-pm controls and logs.
 *
 * @module ops-ui/OperatorDashboard
 */

import type { ReactNode } from "react";
import {
  ControlPlaneProvider,
  Controls,
  Logs,
  useControlPlaneGroupStatus,
  type ControlPlanePort,
  type DashboardGroupTarget,
  type DashboardProcessTarget,
  type DashboardQueueTarget,
} from "../react/index.js";
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
};

const dashboardClassName = (className: string | undefined): string =>
  className === undefined || className.length === 0
    ? "pm-dashboard"
    : `pm-dashboard ${className}`;

type OperatorDashboardContentProps = Omit<OperatorDashboardProps, "port">;

const OperatorDashboardContent = ({
  for: group,
  processes = [],
  queues = [],
  pollIntervalMs = 2000,
  logLines = 80,
  title = "effect-pm ops",
  description = "Live controls and logs for a process group.",
  className,
}: OperatorDashboardContentProps) => {
  const status = useControlPlaneGroupStatus({ pollIntervalMs });
  const processIds = processes.map((process) => process.id);
  const queueIds = queues.map((queue) => queue.id);

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

      <section className="pm-dashboard__grid" aria-label="Dashboard overview">
        <article className="pm-dashboard__card pm-dashboard__card--status">
          <div className="pm-dashboard__card-header">
            <p className="pm-dashboard__section-label">Group status</p>
            <h2>Processes and queues</h2>
          </div>
          <div className="pm-dashboard__table-stack">
            <ProcessStatusTable status={status} />
            <QueueStatusTable status={status} />
          </div>
        </article>

        <article className="pm-dashboard__card pm-dashboard__card--logs">
          <div className="pm-dashboard__card-header">
            <p className="pm-dashboard__section-label">Live logs</p>
            <h2>Streaming tail</h2>
          </div>
          <Logs for={group} lines={logLines} />
        </article>
      </section>

      {processes.length > 0 || queues.length > 0 ? (
        <section className="pm-dashboard__details" aria-label="Scoped controls">
          {processes.length > 0 ? (
            <article className="pm-dashboard__card pm-dashboard__card--detail">
              <div className="pm-dashboard__card-header">
                <p className="pm-dashboard__section-label">Scoped processes</p>
                <h2>Selected process controls</h2>
              </div>
              <ProcessStatusTable status={status} processIds={processIds} />
              {processes.map((process) => (
                <Controls
                  for={process}
                  key={process.id}
                  pollIntervalMs={pollIntervalMs}
                  sharedStatus={status}
                />
              ))}
            </article>
          ) : null}
          {queues.length > 0 ? (
            <article className="pm-dashboard__card pm-dashboard__card--detail">
              <div className="pm-dashboard__card-header">
                <p className="pm-dashboard__section-label">Scoped queues</p>
                <h2>Selected queue controls</h2>
              </div>
              <QueueStatusTable status={status} queueIds={queueIds} />
              {queues.map((queue) => (
                <Controls
                  for={queue}
                  key={queue.id}
                  pollIntervalMs={pollIntervalMs}
                  sharedStatus={status}
                />
              ))}
            </article>
          ) : null}
        </section>
      ) : null}
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

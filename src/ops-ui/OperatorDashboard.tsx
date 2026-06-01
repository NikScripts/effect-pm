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
  type ControlPlanePort,
  type DashboardGroupTarget,
  type DashboardProcessTarget,
  type DashboardQueueTarget,
} from "../react/index.js";

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

/**
 * Production-ready shell around the headless React controls/logs primitives.
 *
 * @public
 */
export const OperatorDashboard = ({
  port,
  for: group,
  processes = [],
  queues = [],
  pollIntervalMs = 2000,
  logLines = 80,
  title = "effect-pm ops",
  description = "Live controls and logs for a process group.",
  className,
}: OperatorDashboardProps) => (
  <ControlPlaneProvider port={port}>
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
        <article className="pm-dashboard__card pm-dashboard__card--controls">
          <div className="pm-dashboard__card-header">
            <p className="pm-dashboard__section-label">Group controls</p>
            <h2>All processes and queues</h2>
          </div>
          <Controls for={group} pollIntervalMs={pollIntervalMs} />
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
          {processes.map((process) => (
            <article className="pm-dashboard__card pm-dashboard__card--detail" key={process.id}>
              <div className="pm-dashboard__card-header">
                <p className="pm-dashboard__section-label">Process</p>
                <h2>{process.id}</h2>
              </div>
              <Controls for={process} pollIntervalMs={pollIntervalMs} />
            </article>
          ))}
          {queues.map((queue) => (
            <article className="pm-dashboard__card pm-dashboard__card--detail" key={queue.id}>
              <div className="pm-dashboard__card-header">
                <p className="pm-dashboard__section-label">Queue</p>
                <h2>{queue.id}</h2>
              </div>
              <Controls for={queue} pollIntervalMs={pollIntervalMs} />
            </article>
          ))}
        </section>
      ) : null}
    </main>
  </ControlPlaneProvider>
);

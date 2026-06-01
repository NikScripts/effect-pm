/**
 * Status tables for the styled ops dashboard.
 *
 * @module ops-ui/StatusTables
 */
// @effect-diagnostics asyncFunction:off — table action buttons call Promise-based ControlPlanePort methods.

import type { ReactNode } from "react";
import type { ProcessGroupDetails, QueueDetails } from "../ProcessGroup.js";
import {
  useControlPlane,
  useControlPlaneMutation,
  type ControlPlaneGroupStatusState,
  type ControlPlaneProcessAction,
  type ControlPlaneQueueAction,
} from "../react/index.js";

const processActions: readonly ControlPlaneProcessAction[] = [
  "start",
  "stop",
  "restart",
  "now",
] as const;

const queueActions: readonly ControlPlaneQueueAction[] = [
  "start",
  "pause",
  "resume",
  "clear",
] as const;

const formatUptime = (ms: number): string => {
  if (ms < 1000) return `${String(ms)}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)}m ${String(seconds % 60)}s`;
};

const formatQueueSize = (size: QueueDetails["size"]): string =>
  `${String(size.total)} total / H${String(size.high)} N${String(size.normal)} L${String(size.low)}`;

const actionLabel = (
  action: ControlPlaneProcessAction | ControlPlaneQueueAction,
): string => {
  switch (action) {
    case "start":
      return "Start";
    case "stop":
      return "Stop";
    case "restart":
      return "Restart";
    case "now":
      return "Run now";
    case "pause":
      return "Pause";
    case "resume":
      return "Resume";
    case "clear":
      return "Clear";
  }
};

const actionIcon = (
  action: ControlPlaneProcessAction | ControlPlaneQueueAction,
): ReactNode => {
  switch (action) {
    case "start":
    case "resume":
      return <path d="M8 5v14l11-7z" />;
    case "stop":
      return <path d="M7 7h10v10H7z" />;
    case "restart":
      return <path d="M17 7a7 7 0 1 0 1.9 6.3h-2.2A5 5 0 1 1 15.6 8.4L13 11h7V4z" />;
    case "now":
      return <path d="M13 2 4 14h7l-1 8 10-13h-7z" />;
    case "pause":
      return <><path d="M7 5h4v14H7z" /><path d="M13 5h4v14h-4z" /></>;
    case "clear":
      return <path d="M7 7h10l-.8 13H7.8zm2-4h6l1 2h4v2H4V5h4zm1 6v9h2V9zm4 0v9h2V9z" />;
  }
};

const statusTone = (status: ProcessGroupDetails["status"]): "good" | "muted" | "warn" =>
  status === "running" ? "good" : status === "stopped" ? "muted" : "warn";

const StatusBadge = ({ tone, children }: {
  readonly tone: "good" | "muted" | "warn";
  readonly children: ReactNode;
}) => (
  <span className="pm-dashboard__badge" data-tone={tone}>{children}</span>
);

type ActionButtonProps = {
  readonly action: ControlPlaneProcessAction | ControlPlaneQueueAction;
  readonly disabled: boolean;
  readonly onClick: () => void;
};

const ActionButton = ({ action, disabled, onClick }: ActionButtonProps) => {
  const label = actionLabel(action);
  return (
    <button
      type="button"
      aria-label={label}
      className="pm-action-button"
      data-pm-action={action}
      disabled={disabled}
      onClick={onClick}
      title={label}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
        {actionIcon(action)}
      </svg>
    </button>
  );
};

export type ProcessStatusTableProps = {
  readonly status: ControlPlaneGroupStatusState;
  readonly processIds?: ReadonlyArray<string>;
};

/** @public */
export const ProcessStatusTable = ({
  status,
  processIds,
}: ProcessStatusTableProps) => {
  const port = useControlPlane();
  const mutation = useControlPlaneMutation();
  const rows = processIds === undefined
    ? status.processes
    : status.processes.filter((process) => processIds.includes(process.name));

  const renderAction = (processName: string, action: ControlPlaneProcessAction) => {
    const key = `process:${processName}:${action}`;
    return (
      <ActionButton
        action={action}
        disabled={mutation.pendingKey === key}
        onClick={() => {
          void mutation.run(key, async () => {
            await port.postProcessAction(processName, action);
            await status.refresh();
          }).catch(() => undefined);
        }}
      />
    );
  };

  return (
    <div className="pm-dashboard__table-wrap" data-pm-table="processes">
      {mutation.error !== null ? <p role="alert">{mutation.error}</p> : null}
      <table className="pm-dashboard__table">
        <thead>
          <tr>
            <th scope="col">Process</th>
            <th scope="col">Status</th>
            <th scope="col">Uptime</th>
            <th scope="col">Armed</th>
            <th scope="col">Active</th>
            <th scope="col">Runs</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((process) => (
            <tr key={process.name}>
              <th scope="row"><code>{process.name}</code></th>
              <td><StatusBadge tone={statusTone(process.status)}>{process.status}</StatusBadge></td>
              <td>{formatUptime(process.uptime)}</td>
              <td>{process.armed ? "yes" : "no"}</td>
              <td>{String(process.activeInstances)}</td>
              <td>{String(process.executions)}</td>
              <td>
                <div className="pm-dashboard__table-actions">
                  {processActions.map((action) => (
                    <span key={action}>{renderAction(process.name, action)}</span>
                  ))}
                </div>
              </td>
            </tr>
          ))}
          {rows.length === 0 && !status.loading ? (
            <tr><td colSpan={7}>No processes reported.</td></tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
};

export type QueueStatusTableProps = {
  readonly status: ControlPlaneGroupStatusState;
  readonly queueIds?: ReadonlyArray<string>;
};

/** @public */
export const QueueStatusTable = ({
  status,
  queueIds,
}: QueueStatusTableProps) => {
  const port = useControlPlane();
  const mutation = useControlPlaneMutation();
  const rows = queueIds === undefined
    ? status.queues
    : status.queues.filter((queue) => queueIds.includes(queue.name));

  const renderAction = (queueName: string, action: ControlPlaneQueueAction) => {
    const key = `queue:${queueName}:${action}`;
    return (
      <ActionButton
        action={action}
        disabled={mutation.pendingKey === key}
        onClick={() => {
          void mutation.run(key, async () => {
            await port.postQueueAction(queueName, action);
            await status.refresh();
          }).catch(() => undefined);
        }}
      />
    );
  };

  return (
    <div className="pm-dashboard__table-wrap" data-pm-table="queues">
      {mutation.error !== null ? <p role="alert">{mutation.error}</p> : null}
      <table className="pm-dashboard__table">
        <thead>
          <tr>
            <th scope="col">Queue</th>
            <th scope="col">Depth</th>
            <th scope="col">Completed</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((queue) => (
            <tr key={queue.name}>
              <th scope="row"><code>{queue.name}</code></th>
              <td>{formatQueueSize(queue.size)}</td>
              <td>{String(queue.completed)}</td>
              <td>
                <div className="pm-dashboard__table-actions">
                  {queueActions.map((action) => (
                    <span key={action}>{renderAction(queue.name, action)}</span>
                  ))}
                </div>
              </td>
            </tr>
          ))}
          {rows.length === 0 && !status.loading ? (
            <tr><td colSpan={4}>No queues reported.</td></tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
};

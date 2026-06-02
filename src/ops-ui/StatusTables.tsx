/**
 * Status tables for the styled ops dashboard.
 *
 * @module ops-ui/StatusTables
 */
// @effect-diagnostics asyncFunction:off — table action buttons call Promise-based ControlPlanePort methods.

import type { ReactNode } from "react";
import { Badge } from "./components/ui/badge.js";
import { Button } from "./components/ui/button.js";
import { ScrollArea } from "./components/ui/scroll-area.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./components/ui/table.js";
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
}) => <Badge className="pm-dashboard__badge" data-tone={tone} variant="secondary">{children}</Badge>;

type ActionButtonProps = {
  readonly action: ControlPlaneProcessAction | ControlPlaneQueueAction;
  readonly disabled: boolean;
  readonly onClick: () => void;
};

const ActionButton = ({ action, disabled, onClick }: ActionButtonProps) => {
  const label = actionLabel(action);
  return (
    <Button
      type="button"
      aria-label={label}
      className="pm-action-button"
      data-pm-action={action}
      disabled={disabled}
      onClick={onClick}
      size="icon"
      title={label}
      variant="ghost"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
        {actionIcon(action)}
      </svg>
    </Button>
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
    <ScrollArea className="pm-dashboard__table-wrap" data-pm-table="processes">
      {mutation.error !== null ? <p role="alert">{mutation.error}</p> : null}
      <Table className="pm-dashboard__table">
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Process</TableHead>
            <TableHead scope="col">Status</TableHead>
            <TableHead scope="col">Uptime</TableHead>
            <TableHead scope="col">Armed</TableHead>
            <TableHead scope="col">Active</TableHead>
            <TableHead scope="col">Runs</TableHead>
            <TableHead scope="col">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((process) => (
            <TableRow key={process.name}>
              <TableHead scope="row"><code>{process.name}</code></TableHead>
              <TableCell><StatusBadge tone={statusTone(process.status)}>{process.status}</StatusBadge></TableCell>
              <TableCell>{formatUptime(process.uptime)}</TableCell>
              <TableCell>{process.armed ? "yes" : "no"}</TableCell>
              <TableCell>{String(process.activeInstances)}</TableCell>
              <TableCell>{String(process.executions)}</TableCell>
              <TableCell>
                <div className="pm-dashboard__table-actions">
                  {processActions.map((action) => (
                    <span key={action}>{renderAction(process.name, action)}</span>
                  ))}
                </div>
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && !status.loading ? (
            <TableRow><TableCell colSpan={7}>No processes reported.</TableCell></TableRow>
          ) : null}
        </TableBody>
      </Table>
    </ScrollArea>
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
    <ScrollArea className="pm-dashboard__table-wrap" data-pm-table="queues">
      {mutation.error !== null ? <p role="alert">{mutation.error}</p> : null}
      <Table className="pm-dashboard__table">
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Queue</TableHead>
            <TableHead scope="col">Depth</TableHead>
            <TableHead scope="col">Completed</TableHead>
            <TableHead scope="col">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((queue) => (
            <TableRow key={queue.name}>
              <TableHead scope="row"><code>{queue.name}</code></TableHead>
              <TableCell>{formatQueueSize(queue.size)}</TableCell>
              <TableCell>{String(queue.completed)}</TableCell>
              <TableCell>
                <div className="pm-dashboard__table-actions">
                  {queueActions.map((action) => (
                    <span key={action}>{renderAction(queue.name, action)}</span>
                  ))}
                </div>
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && !status.loading ? (
            <TableRow><TableCell colSpan={4}>No queues reported.</TableCell></TableRow>
          ) : null}
        </TableBody>
      </Table>
    </ScrollArea>
  );
};

/**
 * Process operator panel backed by {@link ControlPlanePort}.
 *
 * @module react/ProcessGroupControlPanel
 */
// @effect-diagnostics asyncFunction:off globalTimers:off — React hooks use Promise fetch and setInterval polling.

import type { CSSProperties, ReactNode } from "react";
import { formatUptime } from "./controlPanelUtils.js";
import { defaultActionButton, defaultProcessRow } from "./defaultSlots.js";
import { useControlPlane } from "./ControlPlaneContext.js";
import {
  useControlPlaneGroupStatus,
  type ControlPlaneGroupStatusState,
} from "./hooks/useControlPlaneGroupStatus.js";
import { useControlPlaneMutation } from "./hooks/useControlPlaneMutation.js";
import type { ControlPlaneProcessAction } from "./ControlPlanePort.js";
import type { ProcessGroupControlPanelSlots } from "./slots.js";

const processActions: readonly ControlPlaneProcessAction[] = [
  "start",
  "stop",
  "restart",
  "now",
] as const;

export type ProcessGroupControlPanelProps = {
  readonly pollIntervalMs?: number;
  readonly className?: string;
  readonly style?: CSSProperties;
  /** Override markup for shadcn/Tailwind; package ships unstyled defaults. */
  readonly slots?: ProcessGroupControlPanelSlots;
  /** Share one poll loop (e.g. from {@link OperatorControlPanel}). */
  readonly sharedStatus?: ControlPlaneGroupStatusState;
  /** Restrict the panel to one process id. */
  readonly processId?: string;
};

/**
 * Lists managed processes and exposes start/stop/restart/now controls.
 *
 * @public
 */
export const ProcessGroupControlPanel = ({
  pollIntervalMs,
  className,
  style,
  slots = {},
  sharedStatus,
  processId,
}: ProcessGroupControlPanelProps) => {
  const port = useControlPlane();
  const internalStatus = useControlPlaneGroupStatus({
    pollIntervalMs,
    enabled: sharedStatus === undefined,
  });
  const status = sharedStatus ?? internalStatus;
  const mutation = useControlPlaneMutation();

  const groupId = status.contract?.id ?? "…";
  const displayError = mutation.error ?? status.error;
  const visibleProcesses = processId === undefined
    ? status.processes
    : status.processes.filter((process) => process.name === processId);

  const renderAction = (processName: string, action: ControlPlaneProcessAction): ReactNode => {
    const pending = mutation.pendingKey === `${processName}:${action}`;
    const props = {
      action,
      disabled: pending,
      onClick: () => {
        void mutation
          .run(`${processName}:${action}`, async () => {
            await port.postProcessAction(processName, action);
            await status.refresh();
          })
          .catch(() => undefined);
      },
    };
    return slots.actionButton !== undefined
      ? slots.actionButton(props)
      : defaultActionButton(props);
  };

  return (
    <section className={className} style={style} data-pm-group={groupId} data-pm-panel="processes">
      {slots.header !== undefined ? (
        slots.header({ groupId, loading: status.loading })
      ) : (
        <header>
          <h2>Processes</h2>
          <p>
            <code>{groupId}</code>
            {status.loading ? " · loading…" : null}
          </p>
        </header>
      )}

      {displayError !== null ? (
        slots.error !== undefined ? (
          slots.error({ message: displayError })
        ) : (
          <p role="alert">{displayError}</p>
        )
      ) : null}

      <ul>
        {visibleProcesses.map((process) => {
          const actions = (
            <>
              {processActions.map((action) => (
                <span key={action}>{renderAction(process.name, action)}</span>
              ))}
            </>
          );
          const rowProps = {
            process,
            uptimeLabel: formatUptime(process.uptime),
            actions,
          };
          return (
            <span key={process.name}>
              {slots.processRow !== undefined
                ? slots.processRow(rowProps)
                : defaultProcessRow(rowProps)}
            </span>
          );
        })}
      </ul>

      {visibleProcesses.length === 0 && !status.loading ? (
        slots.empty !== undefined ? slots.empty() : <p>No processes reported.</p>
      ) : null}
    </section>
  );
};

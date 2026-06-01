/**
 * Queue operator panel backed by {@link ControlPlanePort}.
 *
 * @module react/QueueControlPanel
 */
// @effect-diagnostics asyncFunction:off globalTimers:off — React hooks use Promise fetch and setInterval polling.

import type { CSSProperties, ReactNode } from "react";
import { formatQueueSize } from "./controlPanelUtils.js";
import { defaultActionButton, defaultQueueRow } from "./defaultSlots.js";
import { useControlPlane } from "./ControlPlaneContext.js";
import {
  useControlPlaneGroupStatus,
  type ControlPlaneGroupStatusState,
} from "./hooks/useControlPlaneGroupStatus.js";
import { useControlPlaneMutation } from "./hooks/useControlPlaneMutation.js";
import type { ControlPlaneQueueAction } from "./ControlPlanePort.js";
import type { QueueControlPanelSlots } from "./slots.js";

const queueActions: readonly ControlPlaneQueueAction[] = [
  "start",
  "pause",
  "resume",
  "clear",
] as const;

export type QueueControlPanelProps = {
  readonly pollIntervalMs?: number;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly slots?: QueueControlPanelSlots;
  readonly sharedStatus?: ControlPlaneGroupStatusState;
  /** Restrict the panel to one queue id. */
  readonly queueId?: string;
};

/**
 * Lists queues from group status and exposes queue worker controls.
 *
 * @public
 */
export const QueueControlPanel = ({
  pollIntervalMs,
  className,
  style,
  slots = {},
  sharedStatus,
  queueId,
}: QueueControlPanelProps) => {
  const port = useControlPlane();
  const internalStatus = useControlPlaneGroupStatus({
    pollIntervalMs,
    enabled: sharedStatus === undefined,
  });
  const status = sharedStatus ?? internalStatus;
  const mutation = useControlPlaneMutation();

  const displayError = mutation.error ?? status.error;
  const visibleQueues = queueId === undefined
    ? status.queues
    : status.queues.filter((queue) => queue.name === queueId);

  const renderAction = (queueName: string, action: ControlPlaneQueueAction): ReactNode => {
    const pending = mutation.pendingKey === `${queueName}:${action}`;
    const props = {
      action,
      disabled: pending,
      onClick: () => {
        void mutation
          .run(`${queueName}:${action}`, async () => {
            await port.postQueueAction(queueName, action);
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
    <section className={className} style={style} data-pm-panel="queues">
      {slots.header !== undefined ? slots.header() : <header><h2>Queues</h2></header>}

      {displayError !== null ? (
        slots.error !== undefined ? (
          slots.error({ message: displayError })
        ) : (
          <p role="alert">{displayError}</p>
        )
      ) : null}

      <ul>
        {visibleQueues.map((queue) => {
          const actions = (
            <>
              {queueActions.map((action) => (
                <span key={action}>{renderAction(queue.name, action)}</span>
              ))}
            </>
          );
          const rowProps = {
            queue,
            sizeLabel: formatQueueSize(queue.size),
            actions,
          };
          return (
            <span key={queue.name}>
              {slots.queueRow !== undefined
                ? slots.queueRow(rowProps)
                : defaultQueueRow(rowProps)}
            </span>
          );
        })}
      </ul>

      {visibleQueues.length === 0 && !status.loading ? (
        slots.empty !== undefined ? slots.empty() : <p>No queues reported.</p>
      ) : null}
    </section>
  );
};

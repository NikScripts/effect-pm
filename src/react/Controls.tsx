/**
 * Adaptive controls panel for group, process, or queue targets.
 *
 * @module react/Controls
 */

import type { CSSProperties } from "react";
import {
  useControlPlaneGroupStatus,
  type ControlPlaneGroupStatusState,
} from "./hooks/useControlPlaneGroupStatus.js";
import { ProcessGroupControlPanel } from "./ProcessGroupControlPanel.js";
import type { ProcessGroupControlPanelProps } from "./ProcessGroupControlPanel.js";
import { QueueControlPanel } from "./QueueControlPanel.js";
import type { QueueControlPanelProps } from "./QueueControlPanel.js";
import type { DashboardTarget } from "./dashboardTarget.js";

export type ControlsProps<Target extends DashboardTarget = DashboardTarget> = {
  readonly for: Target;
  readonly pollIntervalMs?: number;
  readonly className?: string;
  readonly style?: CSSProperties;
  /** Share one poll loop from a parent dashboard. */
  readonly sharedStatus?: ControlPlaneGroupStatusState;
  readonly process?: Omit<
    ProcessGroupControlPanelProps,
    "pollIntervalMs" | "className" | "style" | "sharedStatus" | "processId"
  >;
  readonly queue?: Omit<
    QueueControlPanelProps,
    "pollIntervalMs" | "className" | "style" | "sharedStatus" | "queueId"
  >;
};

/**
 * Renders controls for the provided group, process, or queue declaration.
 *
 * @public
 */
export const Controls = <Target extends DashboardTarget = DashboardTarget>({
  for: target,
  pollIntervalMs,
  className,
  style,
  sharedStatus,
  process,
  queue,
}: ControlsProps<Target>) => {
  const internalStatus = useControlPlaneGroupStatus({
    pollIntervalMs,
    enabled: sharedStatus === undefined,
  });
  const status = sharedStatus ?? internalStatus;

  return (
    <section
      className={className}
      style={style}
      data-pm-panel="controls"
      data-pm-target-kind={target.kind}
      data-pm-target-id={target.id}
    >
      {target.kind === "group" || target.kind === "process" ? (
        <ProcessGroupControlPanel
          sharedStatus={status}
          processId={target.kind === "process" ? target.id : undefined}
          {...process}
        />
      ) : null}
      {target.kind === "group" || target.kind === "queue" ? (
        <QueueControlPanel
          sharedStatus={status}
          queueId={target.kind === "queue" ? target.id : undefined}
          {...queue}
        />
      ) : null}
    </section>
  );
};

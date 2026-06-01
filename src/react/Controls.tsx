/**
 * Adaptive controls panel for group, process, or queue targets.
 *
 * @module react/Controls
 */

import type { CSSProperties } from "react";
import { useControlPlaneGroupStatus } from "./hooks/useControlPlaneGroupStatus.js";
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
  process,
  queue,
}: ControlsProps<Target>) => {
  const sharedStatus = useControlPlaneGroupStatus({ pollIntervalMs });

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
          sharedStatus={sharedStatus}
          processId={target.kind === "process" ? target.id : undefined}
          {...process}
        />
      ) : null}
      {target.kind === "group" || target.kind === "queue" ? (
        <QueueControlPanel
          sharedStatus={sharedStatus}
          queueId={target.kind === "queue" ? target.id : undefined}
          {...queue}
        />
      ) : null}
    </section>
  );
};

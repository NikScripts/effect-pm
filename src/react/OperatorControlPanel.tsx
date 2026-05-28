/**
 * Combined process + queue operator panels.
 *
 * @module react/OperatorControlPanel
 */

import type { CSSProperties } from "react";
import { useControlPlaneGroupStatus } from "./hooks/useControlPlaneGroupStatus.js";
import { ProcessGroupControlPanel } from "./ProcessGroupControlPanel.js";
import type { ProcessGroupControlPanelProps } from "./ProcessGroupControlPanel.js";
import { QueueControlPanel } from "./QueueControlPanel.js";
import type { QueueControlPanelProps } from "./QueueControlPanel.js";

export type OperatorControlPanelProps = {
  readonly pollIntervalMs?: number;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly process?: Omit<ProcessGroupControlPanelProps, "pollIntervalMs" | "className" | "style">;
  readonly queue?: Omit<QueueControlPanelProps, "pollIntervalMs" | "className" | "style">;
};

/**
 * Renders {@link ProcessGroupControlPanel} and {@link QueueControlPanel} together.
 *
 * @public
 */
export const OperatorControlPanel = ({
  pollIntervalMs,
  className,
  style,
  process,
  queue,
}: OperatorControlPanelProps) => {
  const sharedStatus = useControlPlaneGroupStatus({ pollIntervalMs });
  return (
    <div className={className} style={style} data-pm-panel="operator">
      <ProcessGroupControlPanel sharedStatus={sharedStatus} {...process} />
      <QueueControlPanel sharedStatus={sharedStatus} {...queue} />
    </div>
  );
};

/**
 * Optional render slots so apps (e.g. shadcn/ui) own markup and CSS.
 *
 * @module react/slots
 */

import type { ReactNode } from "react";
import type { ProcessManagerLogEntry } from "../LogEntry.js";
import type { ProcessGroupDetails, QueueDetails } from "../ProcessGroup.js";
import type { ControlPlaneProcessAction, ControlPlaneQueueAction } from "./ControlPlanePort.js";
import type { DashboardTarget } from "./dashboardTarget.js";

/** @public */
export type ControlPanelActionButtonProps = {
  readonly action: ControlPlaneProcessAction | ControlPlaneQueueAction;
  readonly disabled: boolean;
  readonly onClick: () => void;
};

/** @public */
export type ProcessRowSlotProps = {
  readonly process: ProcessGroupDetails;
  readonly uptimeLabel: string;
  readonly actions: ReactNode;
};

/** @public */
export type QueueRowSlotProps = {
  readonly queue: QueueDetails;
  readonly sizeLabel: string;
  readonly actions: ReactNode;
};

/** @public */
export type ProcessGroupControlPanelSlots = {
  readonly header?: (props: { readonly groupId: string; readonly loading: boolean }) => ReactNode;
  readonly error?: (props: { readonly message: string }) => ReactNode;
  readonly empty?: () => ReactNode;
  readonly processRow?: (props: ProcessRowSlotProps) => ReactNode;
  readonly actionButton?: (props: ControlPanelActionButtonProps) => ReactNode;
};

/** @public */
export type QueueControlPanelSlots = {
  readonly header?: () => ReactNode;
  readonly error?: (props: { readonly message: string }) => ReactNode;
  readonly empty?: () => ReactNode;
  readonly queueRow?: (props: QueueRowSlotProps) => ReactNode;
  readonly actionButton?: (props: ControlPanelActionButtonProps) => ReactNode;
};

/** @public */
export type LogRowSlotProps = {
  readonly entry: ProcessManagerLogEntry;
};

/** @public */
export type LogsPanelSlots = {
  readonly header?: (props: {
    readonly target: DashboardTarget;
    readonly loading: boolean;
  }) => ReactNode;
  readonly error?: (props: { readonly message: string }) => ReactNode;
  readonly empty?: () => ReactNode;
  readonly logRow?: (props: LogRowSlotProps) => ReactNode;
};

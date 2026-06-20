/**
 * Application-facing control plane port for operator UIs.
 *
 * @module react/ControlPlanePort
 */

import type { ControlResponse } from "../ControlProtocol.js";
import type { ProcessManagerLogEntry } from "../LogEntry.js";
import {
  ProcessGroupContractSchema,
  type ProcessGroupDetails,
  type QueueDetails,
} from "../ProcessGroup.js";
import type { ControlPlaneGroupStatus } from "./controlHttp.js";
import type { DashboardTarget } from "./dashboardTarget.js";

/** Process mutation supported by {@link ControlService} REST. */
export type ControlPlaneProcessAction = "start" | "stop" | "restart" | "now";

/** Queue mutation supported by {@link ControlService} REST. */
export type ControlPlaneQueueAction = "start" | "pause" | "resume" | "clear";

/** Parameters for the unified logs stream/history operation. */
export interface ControlPlaneLogsParams<Target extends DashboardTarget = DashboardTarget> {
  readonly for: Target;
  readonly lines?: number;
  readonly from?: Date;
  readonly to?: Date;
  /** Defaults to true; pass false for a static history snapshot. */
  readonly follow?: boolean;
}

/** Live log session returned by {@link ControlPlanePort.logs}. */
export interface ControlPlaneLogSession {
  readonly entries: AsyncIterable<ProcessManagerLogEntry>;
  readonly close: () => void;
}

/**
 * Stable operator API — not raw HTTP paths.
 *
 * @public
 */
export interface ControlPlanePort {
  readonly getContract: () => Promise<typeof ProcessGroupContractSchema.Type>;
  readonly getStatus: () => Promise<ControlPlaneGroupStatus>;
  readonly getProcess: (id: string) => Promise<ControlResponse<ProcessGroupDetails>>;
  readonly postProcessAction: (
    id: string,
    action: ControlPlaneProcessAction,
  ) => Promise<ControlResponse<unknown>>;
  readonly getQueue: (id: string) => Promise<ControlResponse<QueueDetails>>;
  readonly postQueueAction: (
    id: string,
    action: ControlPlaneQueueAction,
  ) => Promise<ControlResponse<unknown>>;
  readonly logs: (
    params: ControlPlaneLogsParams,
  ) => ControlPlaneLogSession;
}

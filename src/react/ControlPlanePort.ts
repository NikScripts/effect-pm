/**
 * Application-facing control plane port for operator UIs.
 *
 * @module react/ControlPlanePort
 */

import type { ControlResponse } from "../ControlProtocol.js";
import {
  ProcessGroupContractSchema,
  type ProcessGroupDetails,
  type QueueDetails,
} from "../ProcessGroup.js";
import type { ControlPlaneGroupStatus } from "./controlHttp.js";

/** Process mutation supported by {@link ControlService} REST. */
export type ControlPlaneProcessAction = "start" | "stop" | "restart" | "now";

/** Queue mutation supported by {@link ControlService} REST. */
export type ControlPlaneQueueAction = "start" | "pause" | "resume" | "clear";

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
}

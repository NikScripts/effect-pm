/**
 * {@link ControlPlanePort} backed by `fetch` and {@link ControlService} REST routes.
 *
 * @module react/adapters/fetch
 */

import type { ControlResponse } from "../../ControlProtocol.js";
import type { ProcessGroupDetails, QueueDetails } from "../../ProcessGroup.js";
import {
  controlHttpGet,
  controlHttpGetContract,
  controlHttpGetGroupStatus,
  controlHttpLogs,
  controlHttpPost,
  isProcessGroupDetails,
  isQueueDetails,
  type ControlHttpRequestOptions,
  type ControlPlaneGroupStatus,
} from "../controlHttp.js";
import type {
  ControlPlanePort,
  ControlPlaneProcessAction,
  ControlPlaneQueueAction,
} from "../ControlPlanePort.js";

export type FetchControlPlaneAdapterOptions = ControlHttpRequestOptions;

const processPath = (id: string, suffix: string): string =>
  `/processes/${encodeURIComponent(id)}${suffix}`;

const queuePath = (id: string, suffix: string): string =>
  `/queues/${encodeURIComponent(id)}${suffix}`;

const processActionPath = (id: string, action: ControlPlaneProcessAction): string =>
  processPath(id, `/${action === "now" ? "now" : action}`);

const queueActionPath = (id: string, action: ControlPlaneQueueAction): string =>
  queuePath(id, `/${action}`);

const narrowProcessStatus = (
  body: ControlResponse<unknown>,
): ControlResponse<ProcessGroupDetails> => {
  if (body.data !== undefined && isProcessGroupDetails(body.data)) {
    return {
      success: body.success,
      type: "process",
      data: body.data,
      error: body.error,
    };
  }
  return { success: false, error: body.error ?? "Invalid process status payload" };
};

const narrowQueueStatus = (
  body: ControlResponse<unknown>,
): ControlResponse<QueueDetails> => {
  if (body.data !== undefined && isQueueDetails(body.data)) {
    return {
      success: body.success,
      type: "queue",
      data: body.data,
      error: body.error,
    };
  }
  return { success: false, error: body.error ?? "Invalid queue status payload" };
};

/**
 * Build a {@link ControlPlanePort} that calls a control gateway over HTTP.
 *
 * @remarks
 * `baseUrl` should point at the gateway origin path prefix (for example
 * `/api/control`), not at the raw `ControlService` host.
 *
 * @public
 */
export const createFetchControlPlaneAdapter = (
  options: FetchControlPlaneAdapterOptions,
): ControlPlanePort => ({
  getContract: () => controlHttpGetContract(options),
  getStatus: (): Promise<ControlPlaneGroupStatus> =>
    controlHttpGetGroupStatus(options),
  getProcess: (id) =>
    controlHttpGet(options, processPath(id, "")).then(narrowProcessStatus),
  postProcessAction: (id, action) =>
    controlHttpPost(options, processActionPath(id, action)),
  getQueue: (id) =>
    controlHttpGet(options, queuePath(id, "")).then(narrowQueueStatus),
  postQueueAction: (id, action) =>
    controlHttpPost(options, queueActionPath(id, action)),
  logs: (params) => controlHttpLogs(options, params),
});

/**
 * Duck-typed {@link ControlPlanePort} for a tRPC-shaped control client.
 *
 * @module react/adapters/trpc
 */

import type { ControlResponse } from "../../ControlProtocol.js";
import { ProcessGroupContractSchema } from "../../ProcessGroup.js";
import {
  ControlPlaneRequestError,
  type ControlPlaneGroupStatus,
} from "../controlHttp.js";
import type {
  ControlPlanePort,
  ControlPlaneProcessAction,
  ControlPlaneQueueAction,
} from "../ControlPlanePort.js";

/** Input for process mutation procedures. */
export type TrpcProcessActionInput = {
  readonly id: string;
  readonly action: ControlPlaneProcessAction;
};

/** Input for queue mutation procedures. */
export type TrpcQueueActionInput = {
  readonly id: string;
  readonly action: ControlPlaneQueueAction;
};

/**
 * Minimal client shape — mirror your `control` tRPC router without importing
 * `@trpc/client` in this package.
 *
 * @public
 */
export interface TrpcControlPlaneClient {
  readonly contract: {
    readonly query: () => Promise<typeof ProcessGroupContractSchema.Type>;
  };
  readonly status: {
    readonly query: () => Promise<ControlPlaneGroupStatus>;
  };
  readonly processAction: {
    readonly mutate: (input: TrpcProcessActionInput) => Promise<ControlResponse<unknown>>;
  };
  readonly queueAction: {
    readonly mutate: (input: TrpcQueueActionInput) => Promise<ControlResponse<unknown>>;
  };
}

const unsupportedLogs = () => ({
  entries: {
    [Symbol.asyncIterator]: () => ({
      next: () =>
        Promise.reject(
          new ControlPlaneRequestError({
            reason: "tRPC ControlPlanePort logs are not configured",
          }),
        ),
    }),
  },
  close: () => undefined,
});

/**
 * Build a {@link ControlPlanePort} from a duck-typed tRPC client.
 *
 * @public
 */
export const createTrpcControlPlaneAdapter = (
  client: TrpcControlPlaneClient,
): ControlPlanePort => ({
  getContract: () => client.contract.query(),
  getStatus: () => client.status.query(),
  getProcess: (id) =>
    client.status.query().then((status) => {
      const process = status.processes.find((row) => row.name === id);
      if (process === undefined) {
        return { success: false, error: `Process '${id}' not found in status` };
      }
      return { success: true, type: "process", data: process };
    }),
  postProcessAction: (id, action) => client.processAction.mutate({ id, action }),
  getQueue: (id) =>
    client.status.query().then((status) => {
      const queue = status.queues.find((row) => row.name === id);
      if (queue === undefined) {
        return { success: false, error: `Queue '${id}' not found in status` };
      }
      return { success: true, type: "queue", data: queue };
    }),
  postQueueAction: (id, action) => client.queueAction.mutate({ id, action }),
  logs: unsupportedLogs,
});

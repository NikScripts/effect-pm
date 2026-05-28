/**
 * Headless polling hook for {@link ControlPlanePort} group status.
 *
 * @module react/hooks/useControlPlaneGroupStatus
 */
// @effect-diagnostics asyncFunction:off globalTimers:off — React hooks use Promise fetch and setInterval polling.

import { useCallback, useEffect, useState } from "react";
import {
  ProcessGroupContractSchema,
  type ProcessGroupDetails,
  type QueueDetails,
} from "../../ProcessGroup.js";
import { toControlPanelErrorMessage } from "../controlPanelUtils.js";
import { useControlPlane } from "../ControlPlaneContext.js";

export type UseControlPlaneGroupStatusOptions = {
  readonly pollIntervalMs?: number;
  readonly enabled?: boolean;
};

export type ControlPlaneGroupStatusState = {
  readonly contract: typeof ProcessGroupContractSchema.Type | null;
  readonly processes: ReadonlyArray<ProcessGroupDetails>;
  readonly queues: ReadonlyArray<QueueDetails>;
  readonly loading: boolean;
  readonly error: string | null;
  readonly refresh: () => Promise<void>;
};

const defaultPollMs = 2000;

/**
 * Loads contract once and polls `GET /status` on an interval.
 *
 * @public
 */
export const useControlPlaneGroupStatus = (
  options: UseControlPlaneGroupStatusOptions = {},
): ControlPlaneGroupStatusState => {
  const port = useControlPlane();
  const pollIntervalMs = options.pollIntervalMs ?? defaultPollMs;
  const enabled = options.enabled ?? true;

  const [contract, setContract] = useState<typeof ProcessGroupContractSchema.Type | null>(null);
  const [processes, setProcesses] = useState<ReadonlyArray<ProcessGroupDetails>>([]);
  const [queues, setQueues] = useState<ReadonlyArray<QueueDetails>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) {
      return;
    }
    try {
      const status = await port.getStatus();
      setProcesses(status.processes);
      setQueues(status.queues);
      setLoading(false);
      setError(null);
    } catch (cause) {
      setLoading(false);
      setError(toControlPanelErrorMessage(cause));
    }
  }, [enabled, port]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const next = await port.getContract();
        if (!cancelled) {
          setContract(next);
        }
      } catch (cause) {
        if (!cancelled) {
          setLoading(false);
          setError(toControlPanelErrorMessage(cause));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, port]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, pollIntervalMs);
    return () => {
      clearInterval(timer);
    };
  }, [enabled, pollIntervalMs, refresh]);

  return {
    contract,
    processes,
    queues,
    loading,
    error,
    refresh,
  };
};

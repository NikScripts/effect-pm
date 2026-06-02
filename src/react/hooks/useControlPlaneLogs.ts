/**
 * Headless live log hook for {@link ControlPlanePort.logs}.
 *
 * @module react/hooks/useControlPlaneLogs
 */
// @effect-diagnostics asyncFunction:off — React hook consumes an async log stream from the injected port.

import { useEffect, useMemo, useState } from "react";
import type { ProcessManagerLogEntry } from "../../LogEntry.js";
import { toControlPanelErrorMessage } from "../controlPanelUtils.js";
import { useControlPlane } from "../ControlPlaneContext.js";
import type { ControlPlaneLogsParams } from "../ControlPlanePort.js";
import type { DashboardTarget } from "../dashboardTarget.js";

export type UseControlPlaneLogsOptions<Target extends DashboardTarget = DashboardTarget> =
  ControlPlaneLogsParams<Target> & {
    readonly enabled?: boolean;
  };

export type ControlPlaneLogsState = {
  readonly entries: ReadonlyArray<ProcessManagerLogEntry>;
  readonly loading: boolean;
  readonly error: string | null;
};

/**
 * Streams logs for a group, process, or queue target.
 *
 * @public
 */
export const useControlPlaneLogs = <
  Target extends DashboardTarget = DashboardTarget,
>(
  options: UseControlPlaneLogsOptions<Target>,
): ControlPlaneLogsState => {
  const port = useControlPlane();
  const enabled = options.enabled ?? true;
  const fromMs = options.from?.getTime();
  const toMs = options.to?.getTime();
  const [entries, setEntries] = useState<ReadonlyArray<ProcessManagerLogEntry>>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const params = useMemo(
    () => ({
      for: options.for,
      lines: options.lines,
      from: options.from,
      to: options.to,
      follow: options.follow,
    }),
    [options.for, options.lines, options.follow, fromMs, toMs],
  );

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const session = port.logs(params);
    setEntries([]);
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        setLoading(false);
        for await (const entry of session.entries) {
          if (cancelled) {
            return;
          }
          setEntries((current) => [...current, entry]);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(toControlPanelErrorMessage(cause));
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      session.close();
    };
  }, [enabled, params, port]);

  return { entries, loading, error };
};

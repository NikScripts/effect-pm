/**
 * Minimal process operator panel backed by {@link ControlPlanePort}.
 *
 * @module react/ProcessGroupControlPanel
 */
// @effect-diagnostics asyncFunction:off globalTimers:off — React hooks use Promise fetch and setInterval polling.

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import {
  ProcessGroupContractSchema,
  type ProcessGroupDetails,
} from "../ProcessGroup.js";
import { useControlPlane } from "./ControlPlaneContext.js";
import type { ControlPlaneProcessAction } from "./ControlPlanePort.js";
import { ControlPlaneRequestError } from "./controlHttp.js";

export type ProcessGroupControlPanelProps = {
  /** Poll interval for `GET /status` (default 2000 ms). */
  readonly pollIntervalMs?: number;
  readonly className?: string;
  readonly style?: CSSProperties;
};

type PanelState = {
  readonly contract: typeof ProcessGroupContractSchema.Type | null;
  readonly processes: ReadonlyArray<ProcessGroupDetails>;
  readonly loading: boolean;
  readonly error: string | null;
  readonly pendingAction: string | null;
};

const defaultPollMs = 2000;

const processActions: readonly ControlPlaneProcessAction[] = [
  "start",
  "stop",
  "restart",
  "now",
] as const;

const formatUptime = (ms: number): string => {
  if (ms < 1000) {
    return `${String(ms)}ms`;
  }
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${String(seconds)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)}m ${String(seconds % 60)}s`;
};

/**
 * Lists managed processes from the live group status and exposes start/stop controls.
 *
 * @public
 */
export const ProcessGroupControlPanel = ({
  pollIntervalMs = defaultPollMs,
  className,
  style,
}: ProcessGroupControlPanelProps) => {
  const port = useControlPlane();
  const [state, setState] = useState<PanelState>({
    contract: null,
    processes: [],
    loading: true,
    error: null,
    pendingAction: null,
  });

  const refreshStatus = useCallback(async () => {
    try {
      const status = await port.getStatus();
      setState((prev) => ({
        ...prev,
        processes: status.processes,
        loading: false,
        error: null,
      }));
    } catch (error) {
      const message = error instanceof ControlPlaneRequestError
        ? error.reason
        : error instanceof globalThis.Error
        ? error.message
        : String(error);
      setState((prev) => ({ ...prev, loading: false, error: message }));
    }
  }, [port]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const contract = await port.getContract();
        if (!cancelled) {
          setState((prev) => ({ ...prev, contract }));
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof ControlPlaneRequestError
            ? error.reason
            : error instanceof Error
            ? error.message
            : String(error);
          setState((prev) => ({ ...prev, loading: false, error: message }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [port]);

  useEffect(() => {
    void refreshStatus();
    const timer = setInterval(() => {
      void refreshStatus();
    }, pollIntervalMs);
    return () => {
      clearInterval(timer);
    };
  }, [pollIntervalMs, refreshStatus]);

  const runAction = async (processId: string, action: ControlPlaneProcessAction) => {
    const key = `${processId}:${action}`;
    setState((prev) => ({ ...prev, pendingAction: key, error: null }));
    try {
      await port.postProcessAction(processId, action);
      await refreshStatus();
    } catch (error) {
      const message = error instanceof ControlPlaneRequestError
        ? error.reason
        : error instanceof globalThis.Error
        ? error.message
        : String(error);
      setState((prev) => ({ ...prev, error: message }));
    } finally {
      setState((prev) => ({ ...prev, pendingAction: null }));
    }
  };

  const contractId = state.contract?.id ?? "…";

  return (
    <section className={className} style={style} data-pm-group={contractId}>
      <header>
        <h2 style={{ margin: "0 0 0.5rem" }}>Process group</h2>
        <p style={{ margin: 0, opacity: 0.8 }}>
          <code>{contractId}</code>
          {state.loading ? " · loading…" : null}
        </p>
      </header>

      {state.error !== null ? (
        <p role="alert" style={{ color: "#b91c1c" }}>
          {state.error}
        </p>
      ) : null}

      <ul style={{ listStyle: "none", padding: 0, margin: "1rem 0 0" }}>
        {state.processes.map((process) => (
          <li
            key={process.name}
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 8,
              padding: "0.75rem 1rem",
              marginBottom: "0.5rem",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}>
              <div>
                <strong>{process.name}</strong>
                <div style={{ fontSize: "0.875rem", opacity: 0.85 }}>
                  {process.status} · uptime {formatUptime(process.uptime)}
                </div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                {processActions.map((action) => {
                  const pending = state.pendingAction === `${process.name}:${action}`;
                  return (
                    <button
                      key={action}
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        void runAction(process.name, action);
                      }}
                    >
                      {pending ? `${action}…` : action}
                    </button>
                  );
                })}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {state.processes.length === 0 && !state.loading ? (
        <p>No processes reported by the control plane.</p>
      ) : null}
    </section>
  );
};

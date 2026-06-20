/**
 * Live log panel backed by {@link ControlPlanePort.logs}.
 *
 * @module react/Logs
 */

import { Fragment, useLayoutEffect, useRef, type CSSProperties } from "react";
import { defaultLogRow } from "./defaultSlots.js";
import {
  useControlPlaneLogs,
  type ControlPlaneLogsState,
} from "./hooks/useControlPlaneLogs.js";
import type { DashboardTarget } from "./dashboardTarget.js";
import type { LogsPanelSlots } from "./slots.js";

export type LogsProps<Target extends DashboardTarget = DashboardTarget> = {
  readonly for: Target;
  readonly lines?: number;
  readonly from?: Date;
  readonly to?: Date;
  /** Defaults to true; pass false for a static snapshot. */
  readonly follow?: boolean;
  readonly enabled?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly slots?: LogsPanelSlots;
  /** Share a log stream state from a parent component. */
  readonly sharedLogs?: ControlPlaneLogsState;
};

/**
 * Renders live logs for a group, process, or queue target.
 *
 * @public
 */
export const Logs = <Target extends DashboardTarget = DashboardTarget>({
  for: target,
  lines,
  from,
  to,
  follow,
  enabled,
  className,
  style,
  slots = {},
  sharedLogs,
}: LogsProps<Target>) => {
  const internalLogs = useControlPlaneLogs({
    for: target,
    lines,
    from,
    to,
    follow,
    enabled: sharedLogs === undefined ? enabled : false,
  });
  const logs = sharedLogs ?? internalLogs;
  const logListRef = useRef<HTMLOListElement | null>(null);

  useLayoutEffect(() => {
    const list = logListRef.current;
    if (list !== null) {
      list.scrollTop = list.scrollHeight;
    }
  }, [logs.entries.length]);

  return (
    <section
      className={className}
      style={style}
      data-pm-panel="logs"
      data-pm-target-kind={target.kind}
      data-pm-target-id={target.id}
    >
      {slots.header !== undefined ? (
        slots.header({ target, loading: logs.loading })
      ) : (
        <header>
          <h2>Logs</h2>
          <p>
            <code>{target.id}</code>
            {logs.loading ? " · loading…" : null}
          </p>
        </header>
      )}

      {logs.error !== null ? (
        slots.error !== undefined ? (
          slots.error({ message: logs.error })
        ) : (
          <p role="alert">{logs.error}</p>
        )
      ) : null}

      <ol ref={logListRef}>
        {logs.entries.map((entry, index) => (
          <Fragment key={`${entry.date}:${String(index)}`}>
            {slots.logRow !== undefined
              ? slots.logRow({ entry })
              : defaultLogRow({ entry })}
          </Fragment>
        ))}
      </ol>

      {logs.entries.length === 0 && !logs.loading ? (
        slots.empty !== undefined ? slots.empty() : <p>No logs reported.</p>
      ) : null}
    </section>
  );
};

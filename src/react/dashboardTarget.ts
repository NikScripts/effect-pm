/**
 * Browser-safe dashboard targets accepted by React controls and logs.
 *
 * @module react/dashboardTarget
 */

import type {
  ProcessGroupContract,
  ProcessGroupEntry,
} from "../ProcessGroup.js";

/** Browser-safe process declaration metadata accepted by dashboard widgets. */
export interface DashboardProcessTarget {
  readonly id: string;
  readonly kind: "process";
  readonly process: unknown;
}

/** Browser-safe queue declaration metadata accepted by dashboard widgets. */
export interface DashboardQueueTarget {
  readonly id: string;
  readonly kind: "queue";
  readonly tag: unknown;
}

/** Browser-safe group declaration metadata accepted by dashboard widgets. */
export interface DashboardGroupTarget {
  readonly id: string;
  readonly kind: "group";
  readonly entries: readonly ProcessGroupEntry[];
  readonly contract: ProcessGroupContract<string, readonly ProcessGroupEntry[]>;
}

/** Browser-safe group, process, or queue target for `for={...}` props. */
export type DashboardTarget =
  | DashboardGroupTarget
  | DashboardProcessTarget
  | DashboardQueueTarget;

/** Log filters derived from a dashboard target. */
export interface DashboardLogFilters {
  readonly groupId?: string;
  readonly processId?: string;
  readonly queueId?: string;
}

/** Derive log annotation filters from a dashboard target. */
export const logFiltersForDashboardTarget = (
  target: DashboardTarget,
): DashboardLogFilters => {
  switch (target.kind) {
    case "group":
      return { groupId: target.id };
    case "process":
      return { processId: target.id };
    case "queue":
      return { queueId: target.id };
  }
};

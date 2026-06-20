/**
 * Dashboard layout state and persistence helpers.
 *
 * @module ops-ui/dashboardLayout
 */
// @effect-diagnostics globalThis:off globalThisInEffect:off — browser-local layout persistence lives in ops-ui.

import { useCallback, useMemo, useState } from "react";

export type DashboardWidgetId =
  | "status"
  | "logs"
  | "process-controls"
  | "queue-controls";

export type DashboardWidgetKind =
  | "status-table"
  | "logs"
  | "process-controls"
  | "queue-controls";

export interface WidgetLayout {
  readonly colSpan: number;
  readonly order: number;
}

export type DashboardLayout = Record<DashboardWidgetId, WidgetLayout>;

export interface BarWidgetPlacement {
  readonly id: string;
  readonly widget: DashboardWidgetKind | "combined-logs" | "group-console";
}

export interface DashboardBarLayout {
  readonly hidden?: boolean;
  readonly widgets: ReadonlyArray<BarWidgetPlacement>;
}

export type DashboardLayoutChange = (layout: DashboardLayout) => void;

export const dashboardWidgetIds = [
  "status",
  "logs",
  "process-controls",
  "queue-controls",
] as const satisfies ReadonlyArray<DashboardWidgetId>;

export const dashboardWidgetKinds = {
  status: "status-table",
  logs: "logs",
  "process-controls": "process-controls",
  "queue-controls": "queue-controls",
} as const satisfies Record<DashboardWidgetId, DashboardWidgetKind>;

export const defaultDashboardLayout: DashboardLayout = {
  status: { colSpan: 3, order: 1 },
  logs: { colSpan: 3, order: 2 },
  "process-controls": { colSpan: 3, order: 3 },
  "queue-controls": { colSpan: 3, order: 4 },
};

const widgetConstraints: Record<DashboardWidgetId, { readonly min: number; readonly max: number }> = {
  status: { min: 3, max: 8 },
  logs: { min: 3, max: 8 },
  "process-controls": { min: 3, max: 8 },
  "queue-controls": { min: 3, max: 8 },
};

export const clampWidgetSpan = (id: DashboardWidgetId, span: number): number => {
  const constraints = widgetConstraints[id];
  return Math.max(constraints.min, Math.min(constraints.max, Math.trunc(span)));
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const parseWidgetLayout = (
  id: DashboardWidgetId,
  value: unknown,
): WidgetLayout | null => {
  if (!isRecord(value)) return null;
  const colSpan = value["colSpan"];
  const order = value["order"];
  if (typeof colSpan !== "number" || typeof order !== "number") {
    return null;
  }
  return {
    colSpan: clampWidgetSpan(id, colSpan),
    order: Math.max(1, Math.trunc(order)),
  };
};

export const normalizeDashboardLayout = (layout: DashboardLayout): DashboardLayout => {
  const sorted = [...dashboardWidgetIds].sort(
    (left, right) => layout[left].order - layout[right].order,
  );
  return Object.fromEntries(
    sorted.map((id, index) => [
      id,
      {
        colSpan: clampWidgetSpan(id, layout[id].colSpan),
        order: index + 1,
      },
    ]),
  ) as DashboardLayout;
};

export const parseDashboardLayout = (value: unknown): DashboardLayout | null => {
  if (!isRecord(value)) {
    return null;
  }
  const entries: Array<readonly [DashboardWidgetId, WidgetLayout]> = [];
  for (const id of dashboardWidgetIds) {
    const parsed = parseWidgetLayout(id, value[id]);
    if (parsed === null) {
      return null;
    }
    entries.push([id, parsed] as const);
  }
  return normalizeDashboardLayout(Object.fromEntries(entries) as DashboardLayout);
};

const readStoredLayout = (storageKey: string | undefined): DashboardLayout | null => {
  if (storageKey === undefined || typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    return raw === null ? null : parseDashboardLayout(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
};

const writeStoredLayout = (storageKey: string | undefined, layout: DashboardLayout): void => {
  if (storageKey === undefined || typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(layout));
  } catch {
    // Layout persistence should never break controls/logs.
  }
};

export interface UseDashboardLayoutOptions {
  readonly layout?: DashboardLayout;
  readonly layoutStorageKey?: string;
  readonly onLayoutChange?: DashboardLayoutChange;
}

export interface DashboardLayoutState {
  readonly layout: DashboardLayout;
  readonly setLayout: (update: (layout: DashboardLayout) => DashboardLayout) => void;
  readonly resetLayout: () => void;
}

export const useDashboardLayout = ({
  layout,
  layoutStorageKey,
  onLayoutChange,
}: UseDashboardLayoutOptions): DashboardLayoutState => {
  const [internalLayout, setInternalLayout] = useState<DashboardLayout>(() =>
    readStoredLayout(layoutStorageKey) ?? layout ?? defaultDashboardLayout,
  );

  const current = layout ?? internalLayout;

  const commit = useCallback(
    (next: DashboardLayout) => {
      const normalized = normalizeDashboardLayout(next);
      if (layout === undefined) {
        setInternalLayout(normalized);
        writeStoredLayout(layoutStorageKey, normalized);
      }
      onLayoutChange?.(normalized);
    },
    [layout, layoutStorageKey, onLayoutChange],
  );

  const setLayout = useCallback(
    (update: (layout: DashboardLayout) => DashboardLayout) => {
      commit(update(current));
    },
    [commit, current],
  );

  const resetLayout = useCallback(() => {
    commit(defaultDashboardLayout);
  }, [commit]);

  return useMemo(
    () => ({ layout: current, setLayout, resetLayout }),
    [current, resetLayout, setLayout],
  );
};

export const sortedDashboardWidgetIds = (layout: DashboardLayout): ReadonlyArray<DashboardWidgetId> =>
  [...dashboardWidgetIds].sort((left, right) => layout[left].order - layout[right].order);

export const resizeGridWidget = (
  layout: DashboardLayout,
  id: DashboardWidgetId,
  colSpan: number,
): DashboardLayout => ({
  ...layout,
  [id]: {
    ...layout[id],
    colSpan: clampWidgetSpan(id, colSpan),
  },
});

export const reorderDashboardLayout = (
  layout: DashboardLayout,
  activeId: DashboardWidgetId,
  overId: DashboardWidgetId,
): DashboardLayout => {
  if (activeId === overId) {
    return layout;
  }
  const ordered = [...sortedDashboardWidgetIds(layout)];
  const oldIndex = ordered.indexOf(activeId);
  const newIndex = ordered.indexOf(overId);
  if (oldIndex < 0 || newIndex < 0) {
    return layout;
  }
  ordered.splice(oldIndex, 1);
  ordered.splice(newIndex, 0, activeId);
  return {
    ...layout,
    ...Object.fromEntries(
      ordered.map((id, index) => [id, { ...layout[id], order: index + 1 }]),
    ),
  };
};

/**
 * Dashboard layout state and persistence helpers.
 *
 * @module ops-ui/dashboardLayout
 */
// @effect-diagnostics globalThis:off globalThisInEffect:off — browser-local layout persistence lives in ops-ui.

import { useCallback, useMemo, useState } from "react";

export type DashboardWidgetKind =
  | "status-table"
  | "logs"
  | "process-controls"
  | "queue-controls";

export interface GridWidgetPlacement {
  readonly id: string;
  readonly widget: DashboardWidgetKind;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface BarWidgetPlacement {
  readonly id: string;
  readonly widget: DashboardWidgetKind | "combined-logs" | "group-console";
}

export interface DashboardBarLayout {
  readonly hidden?: boolean;
  readonly widgets: ReadonlyArray<BarWidgetPlacement>;
}

export interface DashboardLayout {
  readonly version: 1;
  readonly grid: ReadonlyArray<GridWidgetPlacement>;
  readonly bars?: {
    readonly left?: DashboardBarLayout;
    readonly right?: DashboardBarLayout;
    readonly bottom?: DashboardBarLayout;
  };
}

export type DashboardLayoutChange = (layout: DashboardLayout) => void;

export const defaultDashboardLayout: DashboardLayout = {
  version: 1,
  grid: [
    { id: "status", widget: "status-table", x: 0, y: 0, w: 7, h: 5 },
    { id: "logs", widget: "logs", x: 7, y: 0, w: 5, h: 8 },
    { id: "process-controls", widget: "process-controls", x: 0, y: 5, w: 6, h: 4 },
    { id: "queue-controls", widget: "queue-controls", x: 6, y: 5, w: 6, h: 4 },
  ],
  bars: {
    left: { hidden: true, widgets: [] },
    right: { hidden: true, widgets: [] },
    bottom: { hidden: true, widgets: [] },
  },
};

const validWidgetKinds: ReadonlyArray<DashboardWidgetKind> = [
  "status-table",
  "logs",
  "process-controls",
  "queue-controls",
];

const hasWidgetKind = (value: unknown): value is DashboardWidgetKind =>
  typeof value === "string" && validWidgetKinds.some((kind) => kind === value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const parsePlacement = (value: unknown): GridWidgetPlacement | null => {
  if (!isRecord(value)) return null;
  const id = value["id"];
  const widget = value["widget"];
  const x = value["x"];
  const y = value["y"];
  const w = value["w"];
  const h = value["h"];
  if (
    typeof id !== "string" ||
    !hasWidgetKind(widget) ||
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof w !== "number" ||
    typeof h !== "number"
  ) {
    return null;
  }
  return {
    id,
    widget,
    x: Math.max(0, Math.trunc(x)),
    y: Math.max(0, Math.trunc(y)),
    w: Math.max(1, Math.min(12, Math.trunc(w))),
    h: Math.max(2, Math.trunc(h)),
  };
};

export const parseDashboardLayout = (value: unknown): DashboardLayout | null => {
  if (!isRecord(value) || value["version"] !== 1 || !Array.isArray(value["grid"])) {
    return null;
  }
  const grid = value["grid"].map(parsePlacement).filter((item) => item !== null);
  if (grid.length === 0) {
    return null;
  }
  return { version: 1, grid };
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
      if (layout === undefined) {
        setInternalLayout(next);
        writeStoredLayout(layoutStorageKey, next);
      }
      onLayoutChange?.(next);
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

export const resizeGridWidget = (
  layout: DashboardLayout,
  id: string,
  delta: { readonly w?: number; readonly h?: number },
): DashboardLayout => ({
  ...layout,
  grid: layout.grid.map((item) =>
    item.id === id
      ? {
          ...item,
          w: Math.max(2, Math.min(12, item.w + (delta.w ?? 0))),
          h: Math.max(2, item.h + (delta.h ?? 0)),
        }
      : item,
  ),
});

export const moveGridWidget = (
  layout: DashboardLayout,
  id: string,
  direction: "up" | "down",
): DashboardLayout => {
  const index = layout.grid.findIndex((item) => item.id === id);
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || swapWith < 0 || swapWith >= layout.grid.length) {
    return layout;
  }
  const grid = [...layout.grid];
  const current = grid[index];
  const other = grid[swapWith];
  if (current === undefined || other === undefined) {
    return layout;
  }
  grid[index] = { ...current, x: other.x, y: other.y };
  grid[swapWith] = { ...other, x: current.x, y: current.y };
  return { ...layout, grid };
};

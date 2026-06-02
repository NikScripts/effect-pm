import { describe, expect, it } from "vitest";
import {
  defaultDashboardLayout,
  normalizeDashboardLayout,
  parseDashboardLayout,
  reorderDashboardLayout,
  resizeGridWidget,
  sortedDashboardWidgetIds,
} from "../src/ops-ui/dashboardLayout";

describe("dashboardLayout", () => {
  it("normalizes widget order and clamps spans", () => {
    const layout = normalizeDashboardLayout({
      status: { colSpan: 99, order: 20 },
      logs: { colSpan: 1, order: 10 },
      "process-controls": { colSpan: 4, order: 40 },
      "queue-controls": { colSpan: 5, order: 30 },
    });

    expect(sortedDashboardWidgetIds(layout)).toEqual([
      "logs",
      "status",
      "queue-controls",
      "process-controls",
    ]);
    expect(layout.status.colSpan).toBe(8);
    expect(layout.logs.colSpan).toBe(3);
    expect(layout.logs.order).toBe(1);
  });

  it("reorders widgets by id and preserves spans", () => {
    const layout = reorderDashboardLayout(defaultDashboardLayout, "status", "logs");

    expect(sortedDashboardWidgetIds(layout).slice(0, 2)).toEqual(["logs", "status"]);
    expect(layout.status.colSpan).toBe(defaultDashboardLayout.status.colSpan);
  });

  it("resizes widgets within constraints", () => {
    const wide = resizeGridWidget(defaultDashboardLayout, "status", 12);
    const narrow = resizeGridWidget(defaultDashboardLayout, "status", 1);

    expect(wide.status.colSpan).toBe(8);
    expect(narrow.status.colSpan).toBe(3);
  });

  it("parses persisted layout records", () => {
    const parsed = parseDashboardLayout({
      status: { colSpan: 4, order: 2 },
      logs: { colSpan: 3, order: 1 },
      "process-controls": { colSpan: 3, order: 3 },
      "queue-controls": { colSpan: 3, order: 4 },
    });

    expect(parsed).not.toBeNull();
    expect(parsed === null ? [] : sortedDashboardWidgetIds(parsed)).toEqual([
      "logs",
      "status",
      "process-controls",
      "queue-controls",
    ]);
  });
});

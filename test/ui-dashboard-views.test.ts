/**
 * DashboardViews packaging — merged contributions + platform ready Layers (R = never).
 */
import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as View from "../src/ui/View";
import * as DashboardViews from "../src/ui/DashboardViews";
import * as PriorityView from "../src/ui/PriorityView";
import * as DaemonView from "../src/ui/DaemonView";
import * as WebDashboardViews from "../src/web/DashboardViews";
import * as TuiDashboardViews from "../src/tui/DashboardViews";
import * as WorkPool from "../src/WorkPool";
import * as Daemon from "../src/Daemon";

const Item = Schema.Struct({ n: Schema.Number });
class Jobs extends WorkPool.Tag<Jobs>()("app/Jobs", { payload: Item }) {}
class Nightly extends Daemon.Tag<Nightly>()("app/Nightly") {}

describe("DashboardViews packaging", () => {
  it("web ready layer resolves WorkPool + Priority + Daemon cards", () => {
    const { resolve } = View.react(WebDashboardViews.layer);
    expect(resolve(Jobs, "card").map((r) => r.key)).toEqual([
      "hyperlink/view/pool-card",
    ]);
    expect(resolve(Jobs, "detail").map((r) => r.key)).toEqual([
      "hyperlink/view/pool-detail",
    ]);
    expect(resolve(Nightly, "card").map((r) => r.key)).toEqual([
      "hyperlink/view/daemon-card",
    ]);
    expect(resolve(Nightly, "detail").map((r) => r.key)).toEqual([
      "hyperlink/view/daemon-detail",
    ]);
  });

  it("tui ready layer resolves the same handles", () => {
    const { resolve } = View.react(TuiDashboardViews.layer);
    expect(resolve(Jobs, "card").map((r) => r.key)).toEqual([
      "hyperlink/view/pool-card",
    ]);
    expect(resolve(Nightly, "detail").map((r) => r.key)).toEqual([
      "hyperlink/view/daemon-detail",
    ]);
  });

  it("shared contribution layer has no platform skins (open R)", () => {
    expect(PriorityView.PriorityCard.key).toBe("hyperlink/view/priority-card");
    expect(DaemonView.DaemonDetail.key).toBe("hyperlink/view/daemon-detail");
    // Compiles as a Layer; platform packages close R via skins + View.base.
    void DashboardViews.layer;
  });
});

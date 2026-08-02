/**
 * DashboardViews packaging — shared contributions + platform ready Layers (R = never).
 */
import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Ui from "../src/ui/Ui";
import * as DashboardViews from "../src/ui/DashboardViews";
import * as PriorityView from "../src/ui/PriorityView";
import * as DaemonView from "../src/ui/DaemonView";
import * as WebDashboard from "../src/web/Dashboard";
import * as TuiDashboard from "../src/tui/Dashboard";
import * as WorkPool from "../src/WorkPool";
import * as Daemon from "../src/Daemon";
import * as Gate from "../src/Gate";

const Item = Schema.Struct({ n: Schema.Number });
class Jobs extends WorkPool.Tag<Jobs>()("app/Jobs", { payload: Item }) {}
class Lanes extends WorkPool.priority<Lanes>()("app/Lanes", {
  payload: Item,
  laneCount: 2,
}) {}
class Nightly extends Daemon.Tag<Nightly>()("app/Nightly") {}
class Limit extends Gate.Tag<Limit>()("app/Limit", {
  payload: Schema.String,
  success: Schema.String,
}) {}

const TapApi = HttpApi.make("tap").add(
  HttpApiGroup.make("x").add(
    HttpApiEndpoint.get("get", "/", {
      success: Schema.Void,
    }),
  ),
);
class HttpTap extends Gate.HttpApiClient<HttpTap>()("app/HttpTap", TapApi) {}

describe("DashboardViews packaging", () => {
  it("web ready layer resolves default family cards + details", () => {
    const { resolve } = Ui.react(WebDashboard.layer);
    expect(resolve(Jobs, Ui.ViewKind.Card()).map((r) => r.key)).toEqual([
      "hyperlink/view/pool-card",
    ]);
    expect(resolve(Jobs, Ui.ViewKind.Detail()).map((r) => r.key)).toEqual([
      "hyperlink/view/pool-detail",
    ]);
    expect(resolve(Lanes, Ui.ViewKind.Card()).map((r) => r.key)).toEqual([
      "hyperlink/view/priority-card",
    ]);
    expect(resolve(Nightly, Ui.ViewKind.Card()).map((r) => r.key)).toEqual([
      "hyperlink/view/daemon-card",
    ]);
    expect(resolve(Nightly, Ui.ViewKind.Detail()).map((r) => r.key)).toEqual([
      "hyperlink/view/daemon-detail",
    ]);
    expect(resolve(Limit, Ui.ViewKind.Detail()).map((r) => r.key)).toEqual([
      "hyperlink/view/gate-detail",
    ]);
    expect(resolve(HttpTap, Ui.ViewKind.Card()).map((r) => r.key)).toEqual([
      "hyperlink/view/api-card",
    ]);
  });

  it("tui ready layer resolves the same handles", () => {
    const { resolve } = Ui.react(TuiDashboard.layer);
    expect(resolve(Jobs, Ui.ViewKind.Card()).map((r) => r.key)).toEqual([
      "hyperlink/view/pool-card",
    ]);
    expect(resolve(Nightly, Ui.ViewKind.Detail()).map((r) => r.key)).toEqual([
      "hyperlink/view/daemon-detail",
    ]);
  });

  it("shared contribution layer has no platform provides (open R)", () => {
    expect(PriorityView.PriorityCard.key).toBe("hyperlink/view/priority-card");
    expect(DaemonView.DaemonDetail.key).toBe("hyperlink/view/daemon-detail");
    // Compiles as a Layer; platform packages close R via componentsLayer + Ui.base.
    void DashboardViews.layer;
    void WebDashboard.componentsLayer;
    void TuiDashboard.componentsLayer;
  });
});

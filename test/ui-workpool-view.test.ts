/**
 * WorkPoolView packaging — shared contributions + web ready Layer (R = never).
 */
import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as View from "../src/ui/View";
import * as WorkPoolView from "../src/ui/WorkPoolView";
import * as WebWorkPoolView from "../src/web/WorkPoolView";
import * as WorkPool from "../src/WorkPool";

const Item = Schema.Struct({ n: Schema.Number });
class Jobs extends WorkPool.Tag<Jobs>()("app/Jobs", { payload: Item }) {}

describe("WorkPoolView packaging", () => {
  it("web ready layer resolves WorkPool card + detail", () => {
    const { resolve } = View.react(WebWorkPoolView.layer);
    expect(resolve(Jobs, "card").map((r) => r.key)).toEqual([
      "hyperlink/view/pool-card",
    ]);
    expect(resolve(Jobs, "detail").map((r) => r.key)).toEqual([
      "hyperlink/view/pool-detail",
    ]);
  });

  it("shared handles match WorkPoolView keys", () => {
    expect(WorkPoolView.PoolCard.key).toBe("hyperlink/view/pool-card");
    expect(WorkPoolView.PoolDetail.key).toBe("hyperlink/view/pool-detail");
    expect(WorkPoolView.PoolCard.size).toBe("card");
    expect(WorkPoolView.PoolDetail.size).toBe("detail");
  });
});

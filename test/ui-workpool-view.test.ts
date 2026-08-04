/**
 * WorkPoolView packaging — shared contributions + web ready Layer (R = never).
 */
import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as WorkPoolView from "../src/ui/WorkPoolView";
import * as WebWorkPoolView from "../src/web/WorkPoolView";
import * as WorkPool from "../src/WorkPool";

import * as View from "../src/ui/View";
import * as Views from "../src/ui/Views";

const Item = Schema.Struct({ n: Schema.Number });
class Jobs extends WorkPool.Service<Jobs>()("app/Jobs", { payload: Item }) {}

describe("WorkPoolView packaging", () => {
  it("web ready layer resolves WorkPool card + detail", () => {
    const { resolve } = Views.react(WebWorkPoolView.layer);
    expect(resolve(Jobs, Views.ViewKind.Card()).map((r) => r.key)).toEqual([
      "hyperlink/view/pool-card",
    ]);
    expect(resolve(Jobs, Views.ViewKind.Detail()).map((r) => r.key)).toEqual([
      "hyperlink/view/pool-detail",
    ]);
  });

  it("shared handles match WorkPoolView keys", () => {
    expect(WorkPoolView.PoolCard.key).toBe("hyperlink/view/pool-card");
    expect(WorkPoolView.PoolDetail.key).toBe("hyperlink/view/pool-detail");
    expect(View.getAnnotations(WorkPoolView.PoolCard).size).toEqual(
      Views.ViewKind.Card(),
    );
    expect(View.getAnnotations(WorkPoolView.PoolDetail).size).toEqual(
      Views.ViewKind.Detail(),
    );
  });
});

/**
 * View chrome Layers — bind / only; react requires Layer R = never.
 */
import { describe, expect, it } from "@effect/vitest";
import { Layer, Schema } from "effect";
import * as Group from "../src/Group";
import * as View from "../src/ui/View";
import * as WorkPool from "../src/WorkPool";

const Item = Schema.Struct({ n: Schema.Number });
class Jobs extends WorkPool.Tag<Jobs>()("app/Jobs", { payload: Item }) {}
class Special extends WorkPool.Tag<Special>()("app/Special", { payload: Item }) {}
class Nested extends Group.Tag<Nested>("app/Nested")({ Special }) {}
class AppGroup extends Group.Tag<AppGroup>("app/AppGroup")({ Jobs, Nested }) {}

class PoolCard extends View.Card.Tag<PoolCard>()("hyperlink/view/pool-card") {}

class CustomCard extends View.Card.Tag<CustomCard>()("hyperlink/view/custom-card") {}

class PoolDetail extends View.Detail.Tag<PoolDetail>()("hyperlink/view/pool-detail") {}

const chrome = Layer.mergeAll(
  Layer.succeed(PoolCard, () => null),
  Layer.succeed(CustomCard, () => null),
  Layer.succeed(PoolDetail, () => null),
);

const withChrome = <A, E, R>(contrib: Layer.Layer<A, E, R>) =>
  contrib.pipe(Layer.provideMerge(chrome), Layer.provideMerge(View.base));

describe("View registry", () => {
  it("bind(tag) matches over bind(kind)", () => {
    const viewLayer = withChrome(
      Layer.mergeAll(
        View.bind(Special, PoolCard),
        View.bind(WorkPool.kind, CustomCard),
      ),
    );

    const { resolve } = View.react(viewLayer);
    expect(resolve(Special, "card").map((r) => r.key)).toEqual([
      "hyperlink/view/pool-card",
      "hyperlink/view/custom-card",
    ]);
    expect(resolve(Jobs, "card").map((r) => r.key)).toEqual([
      "hyperlink/view/custom-card",
    ]);
  });

  it("matches stamped WorkPool.kind (never groupId)", () => {
    const viewLayer = withChrome(View.bind(WorkPool.kind, PoolCard));
    const { resolve } = View.react(viewLayer);
    expect(resolve(Jobs, "card").map((r) => r.key)).toEqual([
      "hyperlink/view/pool-card",
    ]);
  });

  it("kind appends preserve order (multi-match)", () => {
    const viewLayer = withChrome(
      Layer.mergeAll(
        View.bind(WorkPool.kind, CustomCard),
        View.bind(WorkPool.kind, PoolCard),
      ),
    );
    expect(
      View.react(viewLayer)
        .resolve(Jobs, "card")
        .map((r) => r.key),
    ).toEqual(["hyperlink/view/custom-card", "hyperlink/view/pool-card"]);
  });

  it("only allowlists sizes present; other sizes still use bind", () => {
    const viewLayer = withChrome(
      Layer.mergeAll(
        View.bind(WorkPool.kind, PoolCard),
        View.bind(WorkPool.kind, PoolDetail),
        View.only(Special, CustomCard),
      ),
    );
    const { resolve } = View.react(viewLayer);
    expect(resolve(Special, "card").map((r) => r.key)).toEqual([
      "hyperlink/view/custom-card",
    ]);
    // detail not in only → still family bind
    expect(resolve(Special, "detail").map((r) => r.key)).toEqual([
      "hyperlink/view/pool-detail",
    ]);
    expect(resolve(Jobs, "card").map((r) => r.key)).toEqual([
      "hyperlink/view/pool-card",
    ]);
  });

  it("later only for the same tag wins (Layer.mergeAll order)", () => {
    const viewLayer = withChrome(
      Layer.mergeAll(
        View.bind(WorkPool.kind, PoolCard),
        View.only(Special, PoolCard),
        View.only(Special, CustomCard),
      ),
    );
    expect(
      View.react(viewLayer)
        .resolve(Special, "card")
        .map((r) => r.key),
    ).toEqual(["hyperlink/view/custom-card"]);
  });

  it("only can list card + detail together", () => {
    const viewLayer = withChrome(
      Layer.mergeAll(
        View.bind(WorkPool.kind, PoolCard),
        View.only(Special, CustomCard, PoolDetail),
      ),
    );
    const { resolve } = View.react(viewLayer);
    expect(resolve(Special, "card").map((r) => r.key)).toEqual([
      "hyperlink/view/custom-card",
    ]);
    expect(resolve(Special, "detail").map((r) => r.key)).toEqual([
      "hyperlink/view/pool-detail",
    ]);
  });
});

describe("View.group + kit.for", () => {
  it("collects nested leaves and exposes groupDash", () => {
    const viewLayer = withChrome(
      Layer.mergeAll(View.group(AppGroup), View.bind(WorkPool.kind, PoolCard)),
    );
    const kit = View.react(viewLayer);
    expect(kit.groupDash?.group.key).toBe("app/AppGroup");
    expect(kit.groupDash?.leaves.map((l) => l.key).sort()).toEqual([
      "app/Jobs",
      "app/Special",
    ]);
  });

  it("kit.for(tag) curries resolve path", () => {
    const viewLayer = withChrome(View.bind(WorkPool.kind, PoolCard));
    const kit = View.react(viewLayer);
    expect(kit.resolve(Jobs, "card").map((r) => r.key)).toEqual([
      "hyperlink/view/pool-card",
    ]);
    const { Card, Detail, Page } = kit.for(Jobs);
    expect(Card.length).toBe(1);
    expect(Detail.length).toBe(1);
    expect(Page.length).toBe(1);
  });
});

describe("View.Tag / Prototype", () => {
  it("card prototype stamps size static", () => {
    expect(PoolCard.size).toBe("card");
    expect(PoolDetail.size).toBe("detail");
    expect(PoolCard.key).toBe("hyperlink/view/pool-card");
  });

  it("Prototype chain merges statics", () => {
    const Base = View.Prototype<{ readonly label: string }>()({ base: true as const });
    const Child = Base.Prototype()({ size: "page" as const });
    class PageView extends Child.Tag<PageView>()("test/page-view") {}
    expect(PageView.base).toBe(true);
    expect(PageView.size).toBe("page");
    expect(PageView.key).toBe("test/page-view");
  });
});

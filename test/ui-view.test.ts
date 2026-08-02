/**
 * View chrome Layers — bind / only; react requires Layer R = never.
 */
import { describe, expect, it } from "@effect/vitest";
import { Layer, Schema } from "effect";
import * as Group from "../src/Group";
import * as View from "../src/ui/View";
import * as Ui from "../src/ui/Ui";
import * as WorkPool from "../src/WorkPool";

const Item = Schema.Struct({ n: Schema.Number });
class Jobs extends WorkPool.Tag<Jobs>()("app/Jobs", { payload: Item }) {}
class Special extends WorkPool.Tag<Special>()("app/Special", { payload: Item }) {}
class Nested extends Group.Tag<Nested>("app/Nested")({ Special }) {}
class AppGroup extends Group.Tag<AppGroup>("app/AppGroup")({ Jobs, Nested }) {}

class PoolCard extends Ui.Card.Tag<PoolCard>()("hyperlink/view/pool-card") {}

class CustomCard extends Ui.Card.Tag<CustomCard>()("hyperlink/view/custom-card") {}

class PoolDetail extends Ui.Detail.Tag<PoolDetail>()("hyperlink/view/pool-detail") {}

const chrome = Layer.mergeAll(
  View.provide(PoolCard, () => null),
  View.provide(CustomCard, () => null),
  View.provide(PoolDetail, () => null),
);

const withChrome = <A, E, R>(contrib: Layer.Layer<A, E, R>) =>
  contrib.pipe(Layer.provideMerge(chrome), Layer.provideMerge(Ui.base));

describe("View registry", () => {
  it("bind(tag) matches over bind(kind)", () => {
    const viewLayer = withChrome(
      Layer.mergeAll(
        Ui.bind(Special, PoolCard),
        Ui.bind(WorkPool.kind, CustomCard),
      ),
    );

    const { resolve } = Ui.react(viewLayer);
    expect(resolve(Special, Ui.ViewKind.Card()).map((r) => r.key)).toEqual([
      "hyperlink/view/pool-card",
      "hyperlink/view/custom-card",
    ]);
    expect(resolve(Jobs, Ui.ViewKind.Card()).map((r) => r.key)).toEqual([
      "hyperlink/view/custom-card",
    ]);
  });

  it("matches stamped WorkPool.kind (never groupId)", () => {
    const viewLayer = withChrome(Ui.bind(WorkPool.kind, PoolCard));
    const { resolve } = Ui.react(viewLayer);
    expect(resolve(Jobs, Ui.ViewKind.Card()).map((r) => r.key)).toEqual([
      "hyperlink/view/pool-card",
    ]);
  });

  it("kind appends preserve order (multi-match)", () => {
    const viewLayer = withChrome(
      Layer.mergeAll(
        Ui.bind(WorkPool.kind, CustomCard),
        Ui.bind(WorkPool.kind, PoolCard),
      ),
    );
    expect(
      Ui.react(viewLayer)
        .resolve(Jobs, Ui.ViewKind.Card())
        .map((r) => r.key),
    ).toEqual(["hyperlink/view/custom-card", "hyperlink/view/pool-card"]);
  });

  it("only allowlists sizes present; other sizes still use bind", () => {
    const viewLayer = withChrome(
      Layer.mergeAll(
        Ui.bind(WorkPool.kind, PoolCard),
        Ui.bind(WorkPool.kind, PoolDetail),
        Ui.only(Special, CustomCard),
      ),
    );
    const { resolve } = Ui.react(viewLayer);
    expect(resolve(Special, Ui.ViewKind.Card()).map((r) => r.key)).toEqual([
      "hyperlink/view/custom-card",
    ]);
    // detail not in only → still family bind
    expect(resolve(Special, Ui.ViewKind.Detail()).map((r) => r.key)).toEqual([
      "hyperlink/view/pool-detail",
    ]);
    expect(resolve(Jobs, Ui.ViewKind.Card()).map((r) => r.key)).toEqual([
      "hyperlink/view/pool-card",
    ]);
  });

  it("later only for the same tag wins (Layer.mergeAll order)", () => {
    const viewLayer = withChrome(
      Layer.mergeAll(
        Ui.bind(WorkPool.kind, PoolCard),
        Ui.only(Special, PoolCard),
        Ui.only(Special, CustomCard),
      ),
    );
    expect(
      Ui.react(viewLayer)
        .resolve(Special, Ui.ViewKind.Card())
        .map((r) => r.key),
    ).toEqual(["hyperlink/view/custom-card"]);
  });

  it("only can list card + detail together", () => {
    const viewLayer = withChrome(
      Layer.mergeAll(
        Ui.bind(WorkPool.kind, PoolCard),
        Ui.only(Special, CustomCard, PoolDetail),
      ),
    );
    const { resolve } = Ui.react(viewLayer);
    expect(resolve(Special, Ui.ViewKind.Card()).map((r) => r.key)).toEqual([
      "hyperlink/view/custom-card",
    ]);
    expect(resolve(Special, Ui.ViewKind.Detail()).map((r) => r.key)).toEqual([
      "hyperlink/view/pool-detail",
    ]);
  });
});

describe("Ui.group + kit.for", () => {
  it("collects nested leaves and exposes groupDash", () => {
    const viewLayer = withChrome(
      Layer.mergeAll(Ui.group(AppGroup), Ui.bind(WorkPool.kind, PoolCard)),
    );
    const kit = Ui.react(viewLayer);
    expect(kit.groupDash?.group.key).toBe("app/AppGroup");
    expect(kit.groupDash?.leaves.map((l) => l.key).sort()).toEqual([
      "app/Jobs",
      "app/Special",
    ]);
  });

  it("kit.for(tag) curries resolve path", () => {
    const viewLayer = withChrome(Ui.bind(WorkPool.kind, PoolCard));
    const kit = Ui.react(viewLayer);
    expect(kit.resolve(Jobs, Ui.ViewKind.Card()).map((r) => r.key)).toEqual([
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
    expect(PoolCard.size).toEqual(Ui.ViewKind.Card());
    expect(PoolDetail.size).toEqual(Ui.ViewKind.Detail());
    expect(PoolCard.key).toBe("hyperlink/view/pool-card");
  });

  it("Prototype chain merges statics", () => {
    const Base = View.Prototype<{ readonly label: string }, Ui.WithSize>()({
      base: true as const,
    });
    const Child = Base.Prototype()({ size: Ui.ViewKind.Page() });
    class PageView extends Child.Tag<PageView>()("test/page-view") {}
    expect(PageView.base).toBe(true);
    expect(PageView.size).toEqual(Ui.ViewKind.Page());
    expect(PageView.key).toBe("test/page-view");
  });
});

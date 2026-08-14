/**
 * View size Layers — bind / only; react requires Layer R = never.
 */
import { describe, expect, it } from "@effect/vitest";
import { Layer, Schema } from "effect";
import * as Last from "last-ts/Last";
import * as Group from "../src/Group";
import * as View from "../src/ui/View";
import * as WorkPool from "../src/WorkPool";

import * as Views from "../src/ui/Views";
const Item = Schema.Struct({ n: Schema.Number });
class Jobs extends WorkPool.Service<Jobs>()("app/Jobs", { payload: Item }) {}
class Special extends WorkPool.Service<Special>()("app/Special", { payload: Item }) {}
class Nested extends Group.Service<Nested>("app/Nested")({ Special }) {}
class AppGroup extends Group.Service<AppGroup>("app/AppGroup")({ Jobs, Nested }) {}

class PoolCard extends Views.Card.Service<PoolCard>()("hyperlink/view/pool-card") {}

class CustomCard extends Views.Card.Service<CustomCard>()("hyperlink/view/custom-card") {}

class PoolDetail extends Views.Detail.Service<PoolDetail>()("hyperlink/view/pool-detail") {}

const sizeHints = Layer.mergeAll(
  Layer.succeed(PoolCard, () => null),
  Layer.succeed(CustomCard, () => null),
  Layer.succeed(PoolDetail, () => null),
);

const withSizeHints = <A, E, R>(contrib: Layer.Layer<A, E, R>) =>
  contrib.pipe(Layer.provideMerge(sizeHints), Layer.provideMerge(Views.base));

describe("View registry", () => {
  it("bind(tag) matches over bind(kind)", () => {
    const viewLayer = withSizeHints(
      Layer.mergeAll(
        Views.bind(Special, PoolCard),
        Views.bind(WorkPool.kind, CustomCard),
      ),
    );

    const { resolve } = Views.react(viewLayer);
    expect(resolve(Special, Views.ViewKind.Card()).map((r) => r.key)).toEqual([
      "hyperlink/view/pool-card",
      "hyperlink/view/custom-card",
    ]);
    expect(resolve(Jobs, Views.ViewKind.Card()).map((r) => r.key)).toEqual([
      "hyperlink/view/custom-card",
    ]);
  });

  it("matches stamped WorkPool.kind (never groupId)", () => {
    const viewLayer = withSizeHints(Views.bind(WorkPool.kind, PoolCard));
    const { resolve } = Views.react(viewLayer);
    expect(resolve(Jobs, Views.ViewKind.Card()).map((r) => r.key)).toEqual([
      "hyperlink/view/pool-card",
    ]);
  });

  it("kind appends preserve order (multi-match)", () => {
    const viewLayer = withSizeHints(
      Layer.mergeAll(
        Views.bind(WorkPool.kind, CustomCard),
        Views.bind(WorkPool.kind, PoolCard),
      ),
    );
    expect(
      Views.react(viewLayer)
        .resolve(Jobs, Views.ViewKind.Card())
        .map((r) => r.key),
    ).toEqual(["hyperlink/view/custom-card", "hyperlink/view/pool-card"]);
  });

  it("only allowlists sizes present; other sizes still use bind", () => {
    const viewLayer = withSizeHints(
      Layer.mergeAll(
        Views.bind(WorkPool.kind, PoolCard),
        Views.bind(WorkPool.kind, PoolDetail),
        Views.only(Special, CustomCard),
      ),
    );
    const { resolve } = Views.react(viewLayer);
    expect(resolve(Special, Views.ViewKind.Card()).map((r) => r.key)).toEqual([
      "hyperlink/view/custom-card",
    ]);
    // detail not in only → still family bind
    expect(resolve(Special, Views.ViewKind.Detail()).map((r) => r.key)).toEqual([
      "hyperlink/view/pool-detail",
    ]);
    expect(resolve(Jobs, Views.ViewKind.Card()).map((r) => r.key)).toEqual([
      "hyperlink/view/pool-card",
    ]);
  });

  it("later only for the same tag wins (Layer.mergeAll order)", () => {
    const viewLayer = withSizeHints(
      Layer.mergeAll(
        Views.bind(WorkPool.kind, PoolCard),
        Views.only(Special, PoolCard),
        Views.only(Special, CustomCard),
      ),
    );
    expect(
      Views.react(viewLayer)
        .resolve(Special, Views.ViewKind.Card())
        .map((r) => r.key),
    ).toEqual(["hyperlink/view/custom-card"]);
  });

  it("only can list card + detail together", () => {
    const viewLayer = withSizeHints(
      Layer.mergeAll(
        Views.bind(WorkPool.kind, PoolCard),
        Views.only(Special, CustomCard, PoolDetail),
      ),
    );
    const { resolve } = Views.react(viewLayer);
    expect(resolve(Special, Views.ViewKind.Card()).map((r) => r.key)).toEqual([
      "hyperlink/view/custom-card",
    ]);
    expect(resolve(Special, Views.ViewKind.Detail()).map((r) => r.key)).toEqual([
      "hyperlink/view/pool-detail",
    ]);
  });
});

describe("Views.group + kit.for", () => {
  it("collects nested leaves and exposes groupDash", () => {
    const viewLayer = withSizeHints(
      Layer.mergeAll(Views.group(AppGroup), Views.bind(WorkPool.kind, PoolCard)),
    );
    const kit = Views.react(viewLayer);
    expect(kit.groupDash?.group.key).toBe("app/AppGroup");
    expect(kit.groupDash?.leaves.map((l) => l.key).sort()).toEqual([
      "app/Jobs",
      "app/Special",
    ]);
  });

  it("kit.for(tag) curries resolve path", () => {
    const viewLayer = withSizeHints(Views.bind(WorkPool.kind, PoolCard));
    const kit = Views.react(viewLayer);
    expect(kit.resolve(Jobs, Views.ViewKind.Card()).map((r) => r.key)).toEqual([
      "hyperlink/view/pool-card",
    ]);
    const { Card, Detail, Page } = kit.for(Jobs);
    expect(Card.length).toBe(1);
    expect(Detail.length).toBe(1);
    expect(Page.length).toBe(1);
  });
});

describe("View.make / Prototype", () => {
  it("card prototype stamps size annotation + Last kind", () => {
    expect(View.getAnnotations(PoolCard).size).toEqual(Views.ViewKind.Card());
    expect(View.getAnnotations(PoolDetail).size).toEqual(Views.ViewKind.Detail());
    expect(PoolCard.key).toBe("hyperlink/view/pool-card");
    expect(Last.kindOf(PoolCard)).toBe(View.kind);
    expect(Last.kindOf(PoolDetail)).toBe("last-ts/View");
  });

  it("Prototype chain merges annotations bag", () => {
    const Base = View.Prototype<{ readonly label: string }, Views.WithSize>()({
      base: true as const,
    });
    const Child = Base.Prototype()({ size: Views.ViewKind.Page() });
    class PageView extends Child.Service<PageView>()("test/page-view") {}
    expect(View.getAnnotations(PageView).base).toBe(true);
    expect(View.getAnnotations(PageView).size).toEqual(Views.ViewKind.Page());
    expect(PageView.key).toBe("test/page-view");
  });

  it("Prototype can open Requirement debt mid-chain", () => {
    const Base = View.Prototype<{ readonly label: string }>()({
      base: true as const,
    });
    const Open = Base.Prototype<{}, Views.WithSize>()();
    const Done = Open.Prototype()({ size: Views.ViewKind.Card() });
    class MidCard extends Done.Service<MidCard>()("test/mid-card") {}
    expect(View.getAnnotations(MidCard).base).toBe(true);
    expect(View.getAnnotations(MidCard).size).toEqual(Views.ViewKind.Card());
  });

  it("class statics stay free of the annotations bag", () => {
    class FreeCard extends Views.Card.Service<FreeCard>()("test/free-card") {
      static readonly custom = "app" as const;
    }
    expect(FreeCard.custom).toBe("app");
    expect(View.getAnnotations(FreeCard).size).toEqual(Views.ViewKind.Card());
  });
});

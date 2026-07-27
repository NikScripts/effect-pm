/**
 * View services — bind requires provide; react requires Layer R = never.
 */
import { describe, expect, it } from "@effect/vitest";
import { Layer, Schema } from "effect";
import * as Group from "../src/Group";
import * as Hyperlink from "../src/Hyperlink";
import * as View from "../src/ui/View";
import * as WorkPool from "../src/WorkPool";

const Item = Schema.Struct({ n: Schema.Number });
class Jobs extends WorkPool.Tag<Jobs>()("app/Jobs", { payload: Item }) {}
class Special extends WorkPool.Tag<Special>()("app/Special", { payload: Item }) {}
class Nested extends Group.Tag<Nested>("app/Nested")({ Special }) {}
class AppGroup extends Group.Tag<AppGroup>("app/AppGroup")({ Jobs, Nested }) {}

const PoolCard = View.make({
  key: "hyperlink/view/pool-card",
  kind: "card",
  spec: { pause: true },
});
const CustomCard = View.make({
  key: "hyperlink/view/custom-card",
  kind: "card",
  spec: {},
});
const PoolDetail = View.make({
  key: "hyperlink/view/pool-detail",
  kind: "detail",
  spec: {},
});

const PoolCardView = () => null;
const CustomCardView = () => null;
const PoolDetailView = () => null;

const chrome = Layer.mergeAll(
  Layer.succeed(PoolCard, PoolCardView),
  Layer.succeed(CustomCard, CustomCardView),
  Layer.succeed(PoolDetail, PoolDetailView),
);

/** Binds require View services — discharge with provideMerge(chrome). */
const withChrome = <A, E, R>(binds: Layer.Layer<A, E, R>) =>
  binds.pipe(Layer.provideMerge(chrome), Layer.provideMerge(View.base));

describe("View registry", () => {
  it("matches bindTag over stamped kind", () => {
    const viewLayer = withChrome(
      Layer.mergeAll(
        View.bindTag(Special, PoolCard),
        View.bindKind(WorkPool.kind, CustomCard), // Jobs would get this; Special has bindTag first
      ),
    );

    const { resolve } = View.react(viewLayer);
    // bindTag first, then kind bind (Special is also a WorkPool)
    expect(resolve(Special, "card").map((r) => r.key)).toEqual([
      "hyperlink/view/pool-card",
      "hyperlink/view/custom-card",
    ]);
    expect(resolve(Jobs, "card").map((r) => r.key)).toEqual([
      "hyperlink/view/custom-card",
    ]);
  });

  it("matches stamped WorkPool.kind binds (never groupId)", () => {
    const viewLayer = withChrome(View.bindKind(WorkPool.kind, PoolCard));

    const { resolve } = View.react(viewLayer);
    expect(resolve(Jobs, "card").map((r) => r.key)).toEqual([
      "hyperlink/view/pool-card",
    ]);
  });

  it("multi-match preserves bind order", () => {
    const viewLayer = withChrome(
      Layer.mergeAll(
        View.bindKind(WorkPool.kind, CustomCard),
        View.bindKind(WorkPool.kind, PoolCard),
      ),
    );

    const keys = View.react(viewLayer)
      .resolve(Jobs, "card")
      .map((r) => r.key);
    expect(keys).toEqual(["hyperlink/view/custom-card", "hyperlink/view/pool-card"]);
  });

  it("Hyperlink.components pin replaces binds for that kind", () => {
    // Own tag — components() Object.assigns; never mutate shared Jobs/Special fixtures
    class PinnedJobs extends WorkPool.Tag<PinnedJobs>()("app/PinnedJobs", {
      payload: Item,
    }) {}
    const Pinned = PinnedJobs.pipe(Hyperlink.components([CustomCard]));
    const viewLayer = withChrome(View.bindKind(WorkPool.kind, PoolCard));

    const { resolve } = View.react(viewLayer);
    expect(resolve(Pinned, "card").map((r) => r.key)).toEqual([
      "hyperlink/view/custom-card",
    ]);
    // detail not in pin array → still automatic binds (none here → empty → fallback at render)
    expect(resolve(Pinned, "detail")).toEqual([]);
  });

  it("pin can include card + detail in one array", () => {
    class DualPin extends WorkPool.Tag<DualPin>()("app/DualPin", { payload: Item }) {}
    const Pinned = DualPin.pipe(Hyperlink.components([CustomCard, PoolDetail]));
    const viewLayer = withChrome(View.bindKind(WorkPool.kind, PoolCard));
    const { resolve } = View.react(viewLayer);
    expect(resolve(Pinned, "card").map((r) => r.key)).toEqual([
      "hyperlink/view/custom-card",
    ]);
    expect(resolve(Pinned, "detail").map((r) => r.key)).toEqual([
      "hyperlink/view/pool-detail",
    ]);
  });
});

describe("View.group + kit.for (W20)", () => {
  it("collects nested leaves and exposes groupDash on react kit", () => {
    const viewLayer = withChrome(
      Layer.mergeAll(
        View.group(AppGroup),
        View.bindKind(WorkPool.kind, PoolCard),
      ),
    );
    const kit = View.react(viewLayer);
    expect(kit.groupDash?.group.key).toBe("app/AppGroup");
    expect(kit.groupDash?.leaves.map((l) => l.key).sort()).toEqual([
      "app/Jobs",
      "app/Special",
    ]);
  });

  it("pinnedViewsOf walks Group leaves for Hyperlink.components pins", () => {
    class PinLeaf extends WorkPool.Tag<PinLeaf>()("app/PinLeaf", { payload: Item }) {}
    const PinnedLeaf = PinLeaf.pipe(Hyperlink.components([CustomCard, PoolDetail]));
    class PinnedNested extends Group.Tag<PinnedNested>("app/PinnedNested")({
      Special: PinnedLeaf,
    }) {}
    class PinnedApp extends Group.Tag<PinnedApp>("app/PinnedApp")({
      Jobs,
      Nested: PinnedNested,
    }) {}

    expect(View.pinnedViewsOf(PinnedApp).map((p) => p.key)).toEqual([
      "hyperlink/view/custom-card",
      "hyperlink/view/pool-detail",
    ]);
  });

  it("requireView + group wires pin-only chrome for react", () => {
    class PinOnly extends WorkPool.Tag<PinOnly>()("app/PinOnly", { payload: Item }) {}
    const Pinned = PinOnly.pipe(Hyperlink.components([CustomCard]));
    class PinGroup extends Group.Tag<PinGroup>("app/PinGroup")({ Jobs: Pinned }) {}

    const ready = Layer.mergeAll(
      View.group(PinGroup),
      View.bindKind(WorkPool.kind, PoolCard),
      View.requireView(CustomCard),
    ).pipe(Layer.provideMerge(chrome), Layer.provideMerge(View.base));

    const { resolve, for: bound, groupDash } = View.react(ready);
    expect(groupDash?.leaves.map((l) => l.key)).toEqual(["app/PinOnly"]);
    expect(resolve(Pinned, "card").map((r) => r.key)).toEqual([
      "hyperlink/view/custom-card",
    ]);
    expect(typeof bound(Pinned).Card).toBe("function");
    expect(typeof bound(Pinned).Detail).toBe("function");
    expect(typeof bound(Pinned).Page).toBe("function");
  });

  it("kit.for(tag) curries the same resolve path as Card tag={…}", () => {
    const viewLayer = withChrome(View.bindKind(WorkPool.kind, PoolCard));
    const kit = View.react(viewLayer);
    expect(kit.resolve(Jobs, "card").map((r) => r.key)).toEqual([
      "hyperlink/view/pool-card",
    ]);
    // Bound matchers exist and close over Jobs (render still needs Provider)
    const { Card, Detail, Page } = kit.for(Jobs);
    expect(Card.length).toBe(1); // props arg
    expect(Detail.length).toBe(1);
    expect(Page.length).toBe(1);
  });
});

/**
 * View services — bind requires provide; react requires Layer R = never.
 */
import { describe, expect, it } from "@effect/vitest";
import { Layer, Schema } from "effect";
import * as Hyperlink from "../src/Hyperlink";
import * as View from "../src/ui/View";
import * as WorkPool from "../src/WorkPool";

const Item = Schema.Struct({ n: Schema.Number });
class Jobs extends WorkPool.Tag<Jobs>()("app/Jobs", { payload: Item }) {}
class Special extends WorkPool.Tag<Special>()("app/Special", { payload: Item }) {}

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
    const Pinned = Jobs.pipe(Hyperlink.components([CustomCard]));
    const viewLayer = withChrome(View.bindKind(WorkPool.kind, PoolCard));

    const { resolve } = View.react(viewLayer);
    expect(resolve(Pinned, "card").map((r) => r.key)).toEqual([
      "hyperlink/view/custom-card",
    ]);
    // detail not in pin array → still automatic binds (none here → empty → fallback at render)
    expect(resolve(Pinned, "detail")).toEqual([]);
  });

  it("pin can include card + detail in one array", () => {
    const Pinned = Jobs.pipe(Hyperlink.components([CustomCard, PoolDetail]));
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

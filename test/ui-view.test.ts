/**
 * View registry — match order (key → stamped kind), multi-match, no groupId.
 */
import { describe, expect, it } from "@effect/vitest";
import { Layer, Schema } from "effect";
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
const MissingCard = View.make({
  key: "hyperlink/view/missing-card",
  kind: "card",
  spec: {},
});

const PoolCardView = () => null;
const CustomCardView = () => null;

describe("View registry", () => {
  it("matches bindTag over stamped kind", () => {
    const viewLayer = Layer.mergeAll(
      View.register(PoolCard, PoolCardView),
      View.bindTag(Special, PoolCard),
      View.bindKind(WorkPool.kind, "hyperlink/view/other"),
    ).pipe(Layer.provideMerge(View.base));

    const { resolve } = View.react(viewLayer);
    expect(resolve(Special, "card").map((r) => r.handle.key)).toEqual([
      "hyperlink/view/pool-card",
    ]);
  });

  it("matches stamped WorkPool.kind binds (never groupId)", () => {
    const viewLayer = Layer.mergeAll(
      View.register(PoolCard, PoolCardView),
      View.bindKind(WorkPool.kind, PoolCard),
    ).pipe(Layer.provideMerge(View.base));

    const { resolve } = View.react(viewLayer);
    expect(resolve(Jobs, "card").map((r) => r.handle.key)).toEqual([
      "hyperlink/view/pool-card",
    ]);
  });

  it("multi-match preserves bind order; skips missing skins", () => {
    const viewLayer = Layer.mergeAll(
      View.register(CustomCard, CustomCardView),
      View.register(PoolCard, PoolCardView),
      View.bindKind(WorkPool.kind, CustomCard),
      View.bindKind(WorkPool.kind, MissingCard), // never registered — W14 skip
      View.bindKind(WorkPool.kind, PoolCard),
    ).pipe(Layer.provideMerge(View.base));

    const keys = View.react(viewLayer)
      .resolve(Jobs, "card")
      .map((r) => r.handle.key);
    expect(keys).toEqual(["hyperlink/view/custom-card", "hyperlink/view/pool-card"]);
  });

  it("duplicate register throws DuplicateViewKey", () => {
    const viewLayer = Layer.mergeAll(
      View.register(PoolCard, PoolCardView),
      View.register(PoolCard, PoolCardView),
    ).pipe(Layer.provideMerge(View.base));
    expect(() => View.react(viewLayer)).toThrow(View.DuplicateViewKey);
  });

  it("ignores costume fields; only key + stamped kind match", () => {
    const Other = View.make({
      key: "hyperlink/view/other-card",
      kind: "card",
      spec: {},
    });
    const viewLayer = Layer.mergeAll(
      View.register(PoolCard, PoolCardView),
      View.register(Other, CustomCardView),
      View.bindTag(Jobs, PoolCard),
    ).pipe(Layer.provideMerge(View.base));

    const { resolve } = View.react(viewLayer);
    // Extra costume fields must not divert match away from bindTag(Jobs).
    expect(
      resolve(Jobs as typeof Jobs & { view: string; groupId: string }, "card").map(
        (r) => r.handle.key,
      ),
    ).toEqual(["hyperlink/view/pool-card"]);
  });
});

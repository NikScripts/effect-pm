/**
 * View registry skeleton — match order + react kit resolve.
 */
import { describe, expect, it } from "@effect/vitest";
import { Layer } from "effect";
import * as View from "../src/ui/View";

const Pool = View.make({
  key: "hyperlink/view/pool",
  spec: { pause: true },
});

describe("View registry", () => {
  it("matches bindTag over kind", () => {
    const viewLayer = Layer.mergeAll(
      View.register(Pool),
      View.bindTag({ key: "app/Special" }, Pool),
      View.bindKind("some-kind", "hyperlink/view/other"),
    ).pipe(Layer.provideMerge(View.base));

    const { resolve } = View.react(viewLayer);
    const tag = { key: "app/Special", groupId: "queue" };
    expect(resolve(tag)?.key).toBe("hyperlink/view/pool");
  });

  it("matches factory groupId", () => {
    const viewLayer = Layer.mergeAll(
      View.register(Pool),
      View.bindFactory({ groupId: "queue" }, Pool),
    ).pipe(Layer.provideMerge(View.base));

    const { resolve } = View.react(viewLayer);
    expect(resolve({ key: "app/Jobs", groupId: "queue" })?.key).toBe("hyperlink/view/pool");
  });

  it("matches tag.view annotation first", () => {
    const Other = View.make({ key: "hyperlink/view/other", spec: {} });
    const viewLayer = Layer.mergeAll(
      View.register(Pool),
      View.register(Other),
      View.bindTag({ key: "app/Jobs" }, Pool),
    ).pipe(Layer.provideMerge(View.base));

    const { resolve } = View.react(viewLayer);
    expect(resolve({ key: "app/Jobs", view: "hyperlink/view/other" })?.key).toBe(
      "hyperlink/view/other",
    );
  });

  it("duplicate register throws DuplicateViewKey", () => {
    const viewLayer = Layer.mergeAll(View.register(Pool), View.register(Pool)).pipe(
      Layer.provideMerge(View.base),
    );
    expect(() => View.react(viewLayer)).toThrow(View.DuplicateViewKey);
  });
});

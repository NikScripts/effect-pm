/**
 * fromPage — bake mode + component from Page mint (no waku/server import).
 */
import { describe, expect, it } from "@effect/vitest";
import * as React from "react";
import * as Page from "last-ts/Page";
import { fromPage } from "../packages/last-ts/src/internal/hostPage";

describe("fromPage", () => {
  it("reads static mode from Page.static", () => {
    class Home extends Page.static(React.createElement("h1", null, "Home")) {}
    const host = fromPage(Home);
    expect(host.render).toBe("static");
    expect(typeof host.component).toBe("function");
  });

  it("reads dynamic mode from Page.make", () => {
    class Docs extends Page.make(React.createElement("h1", null, "Docs")) {}
    const host = fromPage(Docs);
    expect(host.render).toBe("dynamic");
  });

  it("plain component defaults to dynamic", () => {
    const Plain = (): React.ReactElement => React.createElement("span");
    const host = fromPage(Plain);
    expect(host.render).toBe("dynamic");
    expect(typeof host.component).toBe("function");
  });
});

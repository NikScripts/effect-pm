/**
 * RouterBuilder dogfood — Effect page + Page.static stamp.
 */
import { describe, expect, it } from "@effect/vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";
import * as Page from "last-ts/Page";
import {
  DemoProvider,
  Router,
  StampedAbout,
} from "../src/islands/router-page-demo.js";

describe("docs site router-page demo", () => {
  it("Page.static stamps the about component", () => {
    const stamp = Page.stampOf(StampedAbout);
    expect(stamp?.path).toBe("/about");
    expect(stamp?.title).toBe("About");
    expect(stamp?.render._tag).toBe("Static");
  });

  it("Memory Outlet renders Effect home with Page.Request", () => {
    const html = renderToString(
      React.createElement(
        DemoProvider,
        null,
        React.createElement(Router.Outlet),
      ),
    );
    expect(html).toContain("data-demo=\"router-page\"");
    expect(html).toContain("data-page=\"effect-home\"");
    expect(html).toContain("Page.Request pathname: /");
  });
});

/**
 * RouterBuilder dogfood — Effect page + JSX about under Memory.
 */
import { describe, expect, it } from "@effect/vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";
import {
  DemoProvider,
  Router,
} from "../src/islands/router-page-demo.js";

describe("docs site router-page demo", () => {
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

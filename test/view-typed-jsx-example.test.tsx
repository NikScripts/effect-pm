import { describe, expect, it } from "@effect/vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";
import { App } from "../examples/ui/view-typed-jsx/App";

describe("examples/ui/view-typed-jsx", () => {
  it("renders leaf HTML through Last.provide", () => {
    const html = renderToString(React.createElement(App));
    expect(html).toContain('data-demo="inner"');
    expect(html).toContain("hello");
    expect(html).toContain("nik");
    expect(html).toContain('data-demo="outer"');
    expect(html).toContain('data-demo="middle"');
  });
});

/**
 * Book chrome — View.Service default sidebar + standards override.
 */
import { describe, expect, it } from "@effect/vitest";
import { Context } from "effect";
import * as React from "react";
import { renderToString } from "react-dom/server";
import {
  BookSidebar,
  MainBook,
  StandardsBook,
  standardsSidebar,
} from "../src/ui/bookChrome.js";

const groups = [
  {
    label: "Docs",
    items: [{ slug: "index", href: "/docs/index", title: "Intro" }],
  },
];

describe("docs site bookChrome", () => {
  it("BookSidebar is a Reference with default", () => {
    expect(Context.isReference(BookSidebar)).toBe(true);
  });

  it("MainBook renders default sidebar", () => {
    const html = renderToString(
      React.createElement(MainBook, { groups }),
    );
    expect(html).toContain("Intro");
    expect(html).toContain("data-book=\"main\"");
    expect(html).not.toContain("data-book=\"standards\"");
  });

  it("StandardsBook renders overridden sidebar chrome", () => {
    const html = renderToString(
      React.createElement(StandardsBook, { groups }),
    );
    expect(html).toContain("data-book=\"standards\"");
    expect(html).toContain("Intro");
  });

  it("standardsSidebar wrapper marks the book", () => {
    const html = renderToString(standardsSidebar({ groups }));
    expect(html).toContain("data-book=\"standards\"");
  });
});


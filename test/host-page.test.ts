/**
 * fromPage — bake mode + component from Page mint (no waku/server import).
 */
import { describe, expect, it } from "@effect/vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as Page from "last-ts/Page";
import {
  fromPage,
  hostPropsToHandleArgs,
  paramDeclsFromFilePath,
} from "../packages/last-ts/src/internal/hostPage";

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

  it("path overload includes path on the host bag", () => {
    class Home extends Page.static(React.createElement("h1", null, "Home")) {}
    const host = fromPage("/", Home);
    expect(host.path).toBe("/");
    expect(host.render).toBe("static");
  });

  it("adapts Waku flat slug props to nested params", () => {
    class Chapter extends Page.static(
      (props: { readonly params: { readonly slug: string } }) =>
        React.createElement("h1", null, props.params.slug),
    ) {}
    const host = fromPage("/guides/[slug]", Chapter);
    const html = renderToStaticMarkup(
      React.createElement(host.component, {
        path: "/guides/routing",
        slug: "routing",
        query: "",
      }),
    );
    expect(html).toContain("routing");
  });
});

describe("hostPropsToHandleArgs", () => {
  it("nests slug + parses query", () => {
    expect(
      hostPropsToHandleArgs(
        { path: "/guides/routing", slug: "routing", query: "tab=bio" },
        "/guides/[slug]",
      ),
    ).toEqual({
      pathname: "/guides/routing",
      href: "/guides/routing?tab=bio",
      params: { slug: "routing" },
      query: { tab: "bio" },
    });
  });

  it("joins static splat arrays", () => {
    expect(
      hostPropsToHandleArgs(
        { path: ["a", "b"], query: "" },
        "/docs/[...path]",
      ),
    ).toEqual({
      pathname: "/docs/a/b",
      href: "/docs/a/b",
      params: { path: "a/b" },
      query: {},
    });
  });

  it("strips literal prefix when dynamic Waku shadows splat named path", () => {
    expect(
      hostPropsToHandleArgs(
        { path: "/docs/a/b", query: "" },
        "/docs/[...path]",
      ),
    ).toEqual({
      pathname: "/docs/a/b",
      href: "/docs/a/b",
      params: { path: "a/b" },
      query: {},
    });
  });
});

describe("paramDeclsFromFilePath", () => {
  it("reads slug and splat decls", () => {
    expect(paramDeclsFromFilePath("/guides/[slug]")).toEqual([
      { name: "slug", splat: false },
    ]);
    expect(paramDeclsFromFilePath("/docs/[...path]")).toEqual([
      { name: "path", splat: true },
    ]);
  });
});

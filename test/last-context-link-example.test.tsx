/**
 * context-link demo — T2e: no Last.provider(layer, Site); docs kit off home.
 */
import { describe, expect, it } from "@effect/vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";
import * as Router from "last-ts/Router";
import * as Provider from "../examples/last/context-link/lib/Provider";

const At = (props: {
  readonly path: string;
}): React.ReactElement => {
  const router = Router.useRouter();
  if (router.pathname !== props.path) {
    router.go(props.path, { replace: true });
  }
  return React.createElement(Router.Outlet);
};

describe("examples/last/context-link (T2e)", () => {
  it("home mounts NavBar + Last.link; no docs kit", () => {
    const html = renderToString(
      React.createElement(
        Provider.Provider,
        null,
        React.createElement(At, { path: "/" }),
      ),
    );
    expect(html).toContain("data-nav=\"root\"");
    expect(html).toContain("last.ts");
    expect(html).toContain("data-page=\"home\"");
    expect(html).toContain('href="/docs"');
    expect(html).toContain("https://effect.website");
    expect(html).not.toContain("data-docs");
  });

  it("docs mounts docs kit sidebar", () => {
    const html = renderToString(
      React.createElement(
        Provider.Provider,
        null,
        React.createElement(At, { path: "/docs" }),
      ),
    );
    expect(html).toContain("data-nav=\"root\"");
    expect(html).toContain("data-docs=\"sidebar\"");
    expect(html).toContain("Guides");
    expect(html).toContain("data-page=\"docs\"");
  });
});

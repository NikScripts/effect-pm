/**
 * Last.app → children-only Provider (Layer + optional router baked in).
 */
import { describe, expect, it } from "@effect/vitest";
import { Layer } from "effect";
import * as React from "react";
import { renderToString } from "react-dom/server";
import * as AtomReact from "last-ts/AtomReact";
import * as Last from "last-ts/Last";
import * as Route from "last-ts/Route";
import * as Router from "last-ts/Router";

const site = Route.make("site").add(
  Route.get("home", "/home").pipe(
    Route.handle(() => React.createElement("span", null, "home")),
  ),
);

const Ready = (): React.ReactElement => {
  AtomReact.useRuntime();
  return React.createElement("span", null, "ready");
};

describe("Last.app", () => {
  it("Provider takes children only — Layer baked at construction", () => {
    const Provider = Last.app(Layer.empty).Provider;
    const html = renderToString(
      React.createElement(Provider, null, React.createElement(Ready)),
    );
    expect(html).toContain("ready");
  });

  it("toProvider is the one-shot form", () => {
    const Provider = Last.toProvider(Layer.empty);
    const html = renderToString(
      React.createElement(
        Provider,
        null,
        React.createElement("span", null, "ok"),
      ),
    );
    expect(html).toContain("ok");
  });

  it("pipe Last.router bakes Memory without Provider value props", () => {
    const memory = Router.make(site, "Memory");
    const Provider = Last.app(Layer.empty).pipe(Last.router(memory)).Provider;
    const ShowPath = (): React.ReactElement => {
      const router = Router.useRouter();
      return React.createElement("span", null, router.pathname);
    };
    const html = renderToString(
      React.createElement(Provider, null, React.createElement(ShowPath)),
    );
    expect(html).toContain("/");
  });
});

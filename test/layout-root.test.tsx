/**
 * Layout.make / RootLayout / Layout.provide cutover.
 */
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, ManagedRuntime, pipe } from "effect";
import * as React from "react";
import { renderToString } from "react-dom/server";
import * as Document from "last-ts/Document";
import * as Layout from "last-ts/Layout";
import * as Last from "last-ts/Last";
import * as Memory from "last-ts/Memory";
import * as RootLayout from "last-ts/RootLayout";
import * as Route from "last-ts/Route";
import * as Router from "last-ts/Router";
import * as RouterBuilder from "last-ts/RouterBuilder";

class AppShell extends Layout.make()(
  "test/layout/app-shell",
  Effect.sync(() =>
    React.createElement(
      "div",
      { "data-shell": "app" },
      React.createElement(Layout.Outlet),
    ),
  ),
) {}

class Site extends Router.make("layout-site").add(
  Router.group("app", { topLevel: true }).add(
    Route.get("home", "/"),
    Route.get("bare", "/bare"),
  ),
) {}

const home = Effect.succeed(
  React.createElement("span", { "data-page": "home" }, "home"),
);

const bare = Effect.gen(function* () {
  yield* Layout.provide(Layout.Passthrough);
  return React.createElement("span", { "data-page": "bare" }, "bare");
});

const appGroup = pipe(
  RouterBuilder.group(Site, "app", (h) =>
    h.handle("home", home).handle("bare", bare),
  ),
  Layout.provide(AppShell),
);

const routes = pipe(RouterBuilder.layer(Site), Layer.provide(appGroup));
const provider = Last.provider(pipe(Memory.layer, Layer.provide(routes)));

describe("Layout + RootLayout", () => {
  it("group Layout.provide wraps Outlet body", () => {
    const html = renderToString(
      React.createElement(
        provider,
        null,
        React.createElement(Router.Outlet),
      ),
    );
    expect(html).toContain("data-shell=\"app\"");
    expect(html).toContain("data-page=\"home\"");
  });

  it("Layout.provide override last-wins on Layer pipe", async () => {
    const overridden = pipe(appGroup, Layout.provide(Layout.Passthrough));
    const rt = ManagedRuntime.make(
      pipe(RouterBuilder.layer(Site), Layer.provide(overridden)),
    );
    try {
      const registry = await rt.runPromise(
        Effect.gen(function* () {
          return yield* RouterBuilder.Registry;
        }),
      );
      expect(registry.groups.get("app")?.layout).toBe(
        Layout.Passthrough.Component,
      );
    } finally {
      await rt.dispose();
    }
  });

  it("RootLayout.Default reads Document.Fields.lang onto html", () => {
    const cell = Document.makeCell(
      Document.Default,
      Document.title("t"),
      Document.titleTransform((t) => t),
      Document.lang("fr"),
    );
    const html = renderToString(
      React.createElement(
        Document.FieldsProvider,
        { cell },
        React.createElement(
          RootLayout.Default.Component,
          null,
          React.createElement("main", null, "body"),
        ),
      ),
    );
    expect(html).toContain("lang=\"fr\"");
    expect(html).toContain("<main>body</main>");
  });
});

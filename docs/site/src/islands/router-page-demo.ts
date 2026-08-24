/**
 * RouterBuilder + Memory — Effect page handler with Page.Request.
 * Isolated mini-catalog (does not replace Waku file routes).
 */
import * as React from "react";
import { Effect, Layer, pipe } from "effect";
import * as Last from "last-ts/Last";
import * as Layout from "last-ts/Layout";
import * as Memory from "last-ts/Memory";
import * as Page from "last-ts/Page";
import * as Route from "last-ts/Route";
import * as Router from "last-ts/Router";
import * as RouterBuilder from "last-ts/RouterBuilder";

class DemoShell extends Layout.make()(
  "docs/site/layout/demo",
  Effect.sync(() =>
    React.createElement(
      "div",
      {
        "data-demo": "router-page",
        className: "border border-border rounded-lg p-3 text-sm",
      },
      React.createElement(Layout.Outlet),
    ),
  ),
) {}

class DemoSite extends Router.make("docs/site/router-page").add(
  Router.group("app", { topLevel: true }).add(
    Route.get("home", "/"),
    Route.get("about", "/about"),
  ),
) {}

const homePage = Effect.gen(function* () {
  const req = yield* Page.Request;
  return React.createElement(
    "div",
    { "data-page": "effect-home", className: "space-y-1" },
    React.createElement(
      "p",
      { className: "font-medium text-card-foreground" },
      "Effect page handler",
    ),
    React.createElement(
      "p",
      { className: "text-xs text-muted-foreground" },
      `Page.Request pathname: ${req.pathname}`,
    ),
  );
});

const aboutPage = React.createElement(
  "div",
  { "data-page": "about-jsx", className: "space-y-1" },
  React.createElement(
    "p",
    { className: "font-medium text-card-foreground" },
    "JSX page overload",
  ),
  React.createElement(
    "p",
    { className: "text-xs text-muted-foreground" },
    "handle(\"about\", <About />) — element, not Effect",
  ),
);

const routes = pipe(
  RouterBuilder.layer(DemoSite),
  Layer.provide(
    pipe(
      RouterBuilder.group(DemoSite, "app", (h) =>
        h.handle("home", homePage).handle("about", aboutPage),
      ),
      Layout.provide(DemoShell),
    ),
  ),
);

/** Memory transport + RouterBuilder catalog for the island. */
export const DemoProvider = Last.provider(
  pipe(Memory.layer, Layer.provide(routes)),
);

export { Router };

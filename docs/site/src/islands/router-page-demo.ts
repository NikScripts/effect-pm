/**
 * RouterBuilder + Memory — Effect page handler with Page.Request / Document.
 * Isolated mini-catalog (does not replace Waku file routes).
 */
import * as React from "react";
import { Effect, Layer } from "effect";
import type { Layout } from "last-ts/Layout";
import * as Last from "last-ts/Last";
import * as Memory from "last-ts/Memory";
import * as Page from "last-ts/Page";
import * as Route from "last-ts/Route";
import * as Router from "last-ts/Router";
import * as RouterBuilder from "last-ts/RouterBuilder";

const DemoLayout: Layout = ({ children }) =>
  React.createElement(
    "div",
    {
      "data-demo": "router-page",
      className: "border border-border rounded-lg p-3 text-sm",
    },
    children,
  );

class DemoSite extends Router.make("docs/site/router-page").add(
  Router.group("app", { topLevel: true }).add(
    Route.get("home", "/"),
    Route.get("about", "/about"),
  ),
) {}

const homePage = Effect.gen(function* () {
  const req = yield* Page.Request;
  const doc = yield* Page.Document;
  yield* doc.set("Effect Home");
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
    React.createElement(
      "p",
      { className: "text-xs text-muted-foreground" },
      "Document title set to “Effect Home”",
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

/** Stamped file-router mark (plugin reads {@link Page.stampOf}). */
export const StampedAbout = Page.static("/about", () => aboutPage, {
  title: "About",
});

const routes = RouterBuilder.layer(DemoSite).pipe(
  Layer.provide(
    RouterBuilder.group(DemoSite, "app", DemoLayout, (h) =>
      h.handle("home", homePage).handle("about", aboutPage),
    ),
  ),
);

/** Memory transport + RouterBuilder catalog for the island. */
export const DemoProvider = Last.provider(
  Memory.layer.pipe(Layer.provide(routes)),
);

export { Router };

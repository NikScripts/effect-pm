/**
 * Router.Link `to` — PathsOf union / Href brand; bare string banned.
 */
import { expectTypeOf } from "vitest";
import * as React from "react";
import * as Route from "last-ts/Route";
import * as Router from "last-ts/Router";

class App extends Router.make("router-link-to-test-d")
  .add(
    Router.group("main").add(
      Route.get("home", "/"),
      Route.get("about", "/about"),
    ),
    Router.group("docs").add(
      Route.get("index", "/docs"),
      Route.get("chapter", "/docs/:slug"),
    ),
  ) {}

type Paths = Route.PathsOf<typeof App>;
expectTypeOf<Paths>().toEqualTypeOf<
  "/" | "/about" | "/docs" | `/docs/${string}`
>();

const urls = Route.urlBuilder(App);
expectTypeOf(urls.main.home()).toExtend<Route.Href>();
expectTypeOf(urls.docs.chapter("x")).toExtend<Route.Href>();

const _okLiteral = (
  <Router.Link<typeof App> to="/">home</Router.Link>
);
const _okCallback = (
  <Router.Link<typeof App> to={(u) => u.docs.chapter("routing")}>
    chapter
  </Router.Link>
);
const _okHref = (
  <Router.Link<typeof App> to={urls.main.about()}>about</Router.Link>
);
const _okOut = (
  <Router.Link out="https://effect.website">Effect</Router.Link>
);

void _okLiteral;
void _okCallback;
void _okHref;
void _okOut;

// @ts-expect-error bare string not in PathsOf / not Href
const _bad = <Router.Link<typeof App> to="/nope">x</Router.Link>;
void _bad;

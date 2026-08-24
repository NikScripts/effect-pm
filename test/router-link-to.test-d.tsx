/**
 * Router.link(catalog) `to` — PathsOf union; bare string banned.
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

const Link = Router.link(App);

type Paths = Route.PathsOf<typeof App>;
expectTypeOf<Paths>().toEqualTypeOf<
  "/" | "/about" | "/docs" | `/docs/${string}`
>();

const urls = Route.urlBuilder(App);
expectTypeOf(urls.main.home()).toExtend<Route.PathHref<"/">>();
expectTypeOf(urls.docs.chapter("x")).toExtend<Route.PathHref<"/docs/:slug">>();
expectTypeOf(urls.main.about()).toExtend<Route.ToHref<typeof App>>();

const _okLiteral = <Link to="/">home</Link>;
const _okCallback = (
  <Link to={(u) => u.docs.chapter("routing")}>chapter</Link>
);
const _okHref = <Link to={urls.main.about()}>about</Link>;
const _okOut = <Link out="https://effect.website">Effect</Link>;

void _okLiteral;
void _okCallback;
void _okHref;
void _okOut;

// @ts-expect-error bare string not in PathsOf
const _bad = <Link to="/nope">x</Link>;
void _bad;

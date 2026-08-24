/**
 * Last.link — component props ∩ link dest props; no Record<string, any>.
 */
import { expectTypeOf } from "vitest";
import * as React from "react";
import * as Last from "last-ts/Last";
import * as Route from "last-ts/Route";
import * as Router from "last-ts/Router";
import * as View from "last-ts/View";

class App extends Router.make("last-link-props-test-d")
  .add(
    Router.group("main").add(
      Route.get("home", "/"),
    ),
    Router.group("docs").add(
      Route.get("index", "/docs"),
      Route.get("chapter", "/docs/:slug"),
    ),
  ) {}

const Item = (_props: {
  readonly marker: string;
  readonly children?: React.ReactNode;
}): React.ReactElement => React.createElement("span");

class Brand extends View.make<Brand, {
  readonly tone?: string;
  readonly children?: React.ReactNode;
}>()(
  "last-link-props-test-d/Brand",
  (props) => React.createElement("span", null, props.children),
) {}

const DocsItem = Last.link(App, Item, { to: (u) => u.docs });
expectTypeOf<React.ComponentProps<typeof DocsItem>>().toExtend<{
  readonly marker: string;
}>();

const _ok = (
  <DocsItem
    marker="x"
    to={(d) => d.chapter("routing")}
  >
    hi
  </DocsItem>
);
void _ok;

// @ts-expect-error Item requires marker
const _missing = <DocsItem to={(d) => d.index()}>x</DocsItem>;
void _missing;

const ChapterLink = Last.link(App, { to: (u) => u.docs.chapter });
expectTypeOf<React.ComponentProps<typeof ChapterLink>>().toExtend<{
  readonly slug: string;
}>();

const _chapter = <ChapterLink slug="routing">x</ChapterLink>;
void _chapter;

// @ts-expect-error slug required for uncalled route
const _noSlug = <ChapterLink>x</ChapterLink>;
void _noSlug;

const Home = Last.link(App, Item, { to: (u) => u.main.home() });
// direct — no `to` prop
const _home = <Home marker="m">Home</Home>;
void _home;
expectTypeOf<React.ComponentProps<typeof Home>>().not.toHaveProperty("to");

const HomeBrand = Last.link(App, Brand, { to: (u) => u.main.home() });
expectTypeOf<React.ComponentProps<typeof HomeBrand>>().toExtend<{
  readonly tone?: string;
}>();
const _brand = <HomeBrand tone="loud">Brand</HomeBrand>;
void _brand;

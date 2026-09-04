/**
 * Track 2 — Last.use(App) / Last.use(App, "docs") bag typing from `.context`.
 */
import { expectTypeOf } from "vitest";
import { Context } from "effect";
import type * as React from "react";
import * as Last from "last-ts/Last";
import * as Route from "last-ts/Route";
import * as Router from "last-ts/Router";
import * as View from "last-ts/View";

class Brand extends View.make<Brand, {
  readonly children?: React.ReactNode;
}>()(
  "hyperlink-ts/test/last-router-context.test-d/Brand",
  () => null,
) {}

class NavBarContext extends Last.context({ Brand }) {}

class SiteCopy extends Context.Service<SiteCopy, {
  readonly brand: string;
}>()("hyperlink-ts/test/last-router-context.test-d/SiteCopy") {}

class Site extends Last.context({
  NavBar: NavBarContext,
  SiteCopy,
}) {}

class DocsCopy extends Context.Service<DocsCopy, {
  readonly title: string;
}>()("hyperlink-ts/test/last-router-context.test-d/DocsCopy") {}

class DocsKit extends Last.context({ DocsCopy }) {}

class App extends Router.make("last-router-context-test-d")
  .context(Site)
  .add(
    Router.group("main").add(Route.get("home", "/")),
    Router.group("docs")
      .context(DocsKit)
      .add(Route.get("index", "/docs")),
  ) {}

function useRoot() {
  return Last.use(App);
}
expectTypeOf(useRoot().SiteCopy.brand).toEqualTypeOf<string>();
expectTypeOf(useRoot().NavBar.Brand).toMatchTypeOf<
  (props: { readonly children?: React.ReactNode }) => React.ReactElement | null
>();

function useDocs() {
  return Last.use(App, "docs");
}
expectTypeOf(useDocs().DocsCopy.title).toEqualTypeOf<string>();

// Probe: class vs const catalog — group Ctx stamp.
const AppConst = Router.make("last-router-context-test-d-const")
  .context(Site)
  .add(
    Router.group("main").add(Route.get("home", "/")),
    Router.group("docs")
      .context(DocsKit)
      .add(Route.get("index", "/docs")),
  );
type DocsGroupConst = (typeof AppConst)["groups"]["docs"];
expectTypeOf<NonNullable<DocsGroupConst["~LastContext"]>>().toEqualTypeOf<
  typeof DocsKit
>();
type DocsGroupClass = (typeof App)["groups"]["docs"];
expectTypeOf<NonNullable<DocsGroupClass["~LastContext"]>>().toEqualTypeOf<
  typeof DocsKit
>();

// @ts-expect-error SiteCopy.brand is string, not number
const _bad: number = useRoot().SiteCopy.brand;

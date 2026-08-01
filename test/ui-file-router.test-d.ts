/**
 * Route.fileRoot / Router.fileSystem — UrlBuilder keeps path params.
 */
import { expectTypeOf } from "vitest";
import * as Route from "../src/ui/Route";
import * as Router from "../src/ui/Router";

const table = [
  { id: "index", routePath: "/" },
  { id: "docs_chapter", routePath: "/docs/:chapter" },
] as const;

const site = Route.make("fr").add(Route.fileRoot(table));
const urls = Route.urlBuilder(site);

expectTypeOf(urls.index()).toEqualTypeOf<string>();
expectTypeOf(urls.docs_chapter("routing")).toEqualTypeOf<string>();

const viaRouter = Route.make("fr2").add(
  Route.group("root", { topLevel: true }).fromEffect(Router.fileSystem(table)),
);
expectTypeOf(Route.urlBuilder(viaRouter).docs_chapter("x")).toEqualTypeOf<
  string
>();

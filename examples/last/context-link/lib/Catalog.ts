/**
 * @module examples/last/context-link/lib/Catalog
 *
 * Soft-nav catalog — non-`topLevel` groups so runtime ids stay `main` / `docs`
 * (topLevel merges to `__top` in types but keeps the source id at runtime).
 */
import * as Route from "last-ts/Route";
import * as Router from "last-ts/Router";

// ---cut---
export class Catalog extends Router.make("examples/last/context-link").add(
  Router.group("main").add(
    Route.get("home", "/"),
    Route.get("about", "/about"),
  ),
  Router.group("docs").add(
    Route.get("index", "/docs"),
    Route.get("chapter", "/docs/:slug"),
  ),
) {}

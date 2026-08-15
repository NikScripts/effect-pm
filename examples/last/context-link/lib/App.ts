/**
 * @module examples/last/context-link/lib/App
 *
 * Catalog declares context scopes; builder owes those Layers.
 * Path shape matches {@link ./Catalog} (typed `Last.link` uses Catalog).
 */
import * as Route from "last-ts/Route";
import * as Router from "last-ts/Router";
import * as DocsKit from "./DocsKit";
import * as Site from "./Site";

export class App extends Router.make("examples/last/context-link")
  .context(Site.Site)
  .add(
    Router.group("main").add(
      Route.get("home", "/"),
      Route.get("about", "/about"),
    ),
    Router.group("docs")
      .context(DocsKit.DocsKit)
      .add(
        Route.get("index", "/docs"),
        Route.get("chapter", "/docs/:slug"),
      ),
  ) {}

/**
 * @module examples/last/router-context/lib/Catalog
 *
 * Path catalog + derived {@link Link} (same module — {@link Router.link}).
 * No Site/DocsKit imports so NavBar can soft-nav without a Site ↔ NavBar cycle.
 */
import { Schema } from "effect";
import * as Route from "last-ts/Route";
import * as Router from "last-ts/Router";

export class Catalog extends Router.make("examples/last/router-context").add(
  Router.group("main").add(
    Route.get("home", "/"),
    Route.get("about", "/about"),
  ),
  Router.group("docs").add(
    Route.get("index", "/docs"),
    Route.get("chapter", "/docs/:slug", {
      params: { slug: Schema.String },
    }),
  ),
) {}

/** Typesafe soft-nav for this catalog. */
export const Link = Router.link(Catalog);

export type Urls = Route.UrlBuilder<typeof Catalog>;
export type Paths = Route.PathsOf<typeof Catalog>;
export type To = Route.ToHref<typeof Catalog>;

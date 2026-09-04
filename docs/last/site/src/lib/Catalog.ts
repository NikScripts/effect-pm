/**
 * Path catalog + urlBuilder — no SiteKit / Frame imports (breaks ui ↔ site cycle).
 * Soft-nav runtime is {@link ./site.Site}; paths must stay aligned.
 */
import { Schema } from "effect";
import * as Route from "last-ts/Route";
import * as Router from "last-ts/Router";

export class Catalog extends Router.make("last-ts").add(
  Route.get("index", "/"),
  Route.get("about", "/about"),
  Route.get("view", "/view"),
  Route.get("guides_slug", "/guides/:slug", {
    params: { slug: Schema.Literals(["routing", "view-service"]) },
  }),
  Route.get("docs_path", "/docs/*path", {
    params: { path: Schema.String },
  }),
) {}

export const urls = Route.urlBuilder(Catalog);

export type Paths = Route.PathsOf<typeof Catalog>;
export type To = Route.ToHref<typeof Catalog>;

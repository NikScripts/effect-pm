/**
 * Typed catalog for soft-nav urls — file routes own render (RSC).
 */
import * as Route from "last-ts/Route";
import * as Router from "last-ts/Router";

export class Site extends Router.make("last-ts-site").add(
  Router.group("app", { topLevel: true }).add(
    Route.get("home", "/"),
    Route.get("view", "/view"),
    Route.get("about", "/about"),
    Route.get("chapter", "/guides/:slug"),
  ),
) {}

export const urls = Route.urlBuilder(Site);

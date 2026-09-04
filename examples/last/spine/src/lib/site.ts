/**
 * Typed catalog — paths align with fileRouter `paths.gen`; bodies are Page mints.
 */
import { Layer, pipe, Schema } from "effect";
import * as Layout from "last-ts/Layout";
import * as Route from "last-ts/Route";
import * as Router from "last-ts/Router";
import * as RouterBuilder from "last-ts/RouterBuilder";
import { About } from "../pages/about";
import { Chapter } from "../pages/guides/[slug]";
import { Home } from "../pages/index";

export class Site extends Router.make("last-ts/spine").add(
  Route.get("index", "/"),
  Route.get("about", "/about"),
  Route.get("guides_slug", "/guides/:slug", {
    params: { slug: Schema.Literals(["routing", "provider"]) },
  }),
) {}

export const urls = Route.urlBuilder(Site);

/** Typesafe soft-nav — Waku Layer only swaps the location engine. */
export const Link = Router.link(Site);

const app = pipe(
  RouterBuilder.group(Site, "__top", (h) =>
    h
      .handle("index", Home)
      .handle("about", About)
      .handle("guides_slug", Chapter),
  ),
  Layout.provide(Layout.Passthrough),
);

export const routes = pipe(RouterBuilder.layer(Site), Layer.provide(app));

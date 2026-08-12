/**
 * Typed catalog — paths align with fileRouter `paths.gen`; bodies are Page mints.
 */
import { Layer, pipe, Schema } from "effect";
import * as Layout from "last-ts/Layout";
import * as Route from "last-ts/Route";
import * as Router from "last-ts/Router";
import * as RouterBuilder from "last-ts/RouterBuilder";
import { About } from "../pages/about";
import { DocsPath } from "../pages/docs/[...path]";
import { Chapter } from "../pages/guides/[slug]";
import { Home } from "../pages/index";
import { ViewPage } from "../pages/view";
import * as Frame from "./Frame";

export class Site extends Router.make("last-ts").add(
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

export const urls = Route.urlBuilder(Site);

const app = pipe(
  RouterBuilder.group(Site, "__top", (h) =>
    h
      .handle("index", Home)
      .handle("about", About)
      .handle("guides_slug", Chapter)
      .handle("view", ViewPage)
      .handle("docs_path", DocsPath),
  ),
  Layout.provide(Frame.App),
);

export const routes = pipe(RouterBuilder.layer(Site), Layer.provide(app));

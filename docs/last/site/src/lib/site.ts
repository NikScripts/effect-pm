/**
 * Typed catalog + routes — `.context(SiteKit)` + `Last.provideContext`.
 * Paths align with fileRouter `paths.gen` and {@link ./Catalog}.
 */
import { Layer, pipe, Schema } from "effect";
import * as Last from "last-ts/Last";
import * as Layout from "last-ts/Layout";
import * as Route from "last-ts/Route";
import * as Router from "last-ts/Router";
import * as RouterBuilder from "last-ts/RouterBuilder";
import * as About from "../pages/about";
import * as DocsPath from "../pages/docs/[...path]";
import * as Chapter from "../pages/guides/[slug]";
import * as Home from "../pages/index";
import * as ViewPage from "../pages/view";
import * as Frame from "./Frame";
import * as SiteKit from "./SiteKit";

export class Site extends Router.make("last-ts")
  .context(SiteKit.SiteKit)
  .add(
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

/** @deprecated Prefer {@link ./Catalog.urls} — kept for any stray imports. */
export { urls } from "./Catalog";

const app = pipe(
  RouterBuilder.group(Site, "__top", (h) =>
    h
      .handle("index", Home.Home)
      .handle("about", About.About)
      .handle("guides_slug", Chapter.Chapter)
      .handle("view", ViewPage.ViewPage)
      .handle("docs_path", DocsPath.DocsPath),
  ),
  Layout.provide(Frame.App),
  // Views are Reference defaults — discharge SiteKit scope (no required Services).
  Last.provideContext(SiteKit.SiteKit, Layer.empty),
);

export const routes = pipe(
  RouterBuilder.layer(Site),
  Layer.provideMerge(app),
);

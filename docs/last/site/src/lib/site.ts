/**
 * Typed catalog — HttpApi-shaped `Router.make` + `Route.get` (see
 * `docs/handoffs/router-httpapi-lock.md`). Host registration is
 * `last-ts/server`; path table is `last-ts/vite` `fileRouter`.
 */
import { Layer, pipe, Schema } from "effect";
import * as Layout from "last-ts/Layout";
import * as Route from "last-ts/Route";
import * as Router from "last-ts/Router";
import * as RouterBuilder from "last-ts/RouterBuilder";

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

/** Catalog + registry for `last-ts/Waku` layer (page bodies via `last-ts/server`). */
const app = pipe(
  RouterBuilder.group(Site, "__top", (h) =>
    h
      .handle("index", () => null)
      .handle("about", () => null)
      .handle("guides_slug", () => null)
      .handle("view", () => null)
      .handle("docs_path", () => null),
  ),
  Layout.provide(Layout.Passthrough),
);

export const routes = pipe(RouterBuilder.layer(Site), Layer.provide(app));

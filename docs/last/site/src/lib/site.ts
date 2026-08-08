/**
 * Typed catalog — HttpApi-shaped `Router.make` + `Route.get` (see
 * `docs/handoffs/router-httpapi-lock.md`). No `fileRootFromPages` / Page-class
 * merge / `getConfig` (banned — `docs/handoffs/last-ts-api-corrections.md`).
 */
import { Layer, Schema } from "effect";
import type { Layout } from "last-ts/Layout";
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

const Passthrough: Layout = ({ children }) => children as never;

/** Catalog + registry for Waku.layer (file routes own page bodies). */
const app = RouterBuilder.group(Site, "__top", Passthrough, (h) =>
  h
    .handle("index", () => null)
    .handle("about", () => null)
    .handle("guides_slug", () => null)
    .handle("view", () => null)
    .handle("docs_path", () => null),
);

export const routes = RouterBuilder.layer(Site).pipe(Layer.provide(app));

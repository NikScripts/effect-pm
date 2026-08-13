/**
 * @module examples/last/context-link/lib/routes
 *
 * Minimal handlers so `Memory` + `Last.link` resolve under a live Router.
 */
import { Layer, pipe } from "effect";
import * as Layout from "last-ts/Layout";
import * as RouterBuilder from "last-ts/RouterBuilder";
import * as Catalog from "./Catalog";

// ---cut---
const main = pipe(
  RouterBuilder.group(Catalog.Catalog, "main", (h) =>
    h
      .handle("home", () => <span>home</span>)
      .handle("about", () => <span>about</span>),
  ),
  Layout.provide(Layout.Passthrough),
);

const docs = pipe(
  RouterBuilder.group(Catalog.Catalog, "docs", (h) =>
    h
      .handle("index", () => <span>docs</span>)
      .handle("chapter", () => <span>chapter</span>),
  ),
  Layout.provide(Layout.Passthrough),
);

export const routes = pipe(
  RouterBuilder.layer(Catalog.Catalog),
  Layer.provide(Layer.mergeAll(main, docs)),
);

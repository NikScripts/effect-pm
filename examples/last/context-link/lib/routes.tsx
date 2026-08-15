/**
 * @module examples/last/context-link/lib/routes
 *
 * Handlers + Layout.provide + Last.provideContext (builder debt).
 */
import * as React from "react";
import { Layer, pipe } from "effect";
import * as Last from "last-ts/Last";
import * as Layout from "last-ts/Layout";
import * as RouterBuilder from "last-ts/RouterBuilder";
import * as App from "./App";
import * as AppLayout from "./AppLayout";
import * as DocsCopy from "./DocsCopy";
import * as DocsKit from "./DocsKit";
import * as DocsLayout from "./DocsLayout";
import * as Site from "./Site";
import * as SiteCopy from "./SiteCopy";

const main = pipe(
  RouterBuilder.group(App.App, "main", (h) =>
    h
      .handle("home", () => <span data-page="home">home</span>)
      .handle("about", () => <span data-page="about">about</span>),
  ),
  Layout.provide(AppLayout.AppLayout),
);

const docs = pipe(
  RouterBuilder.group(App.App, "docs", (h) =>
    h
      .handle("index", () => <span data-page="docs">docs</span>)
      .handle("chapter", () => <span data-page="chapter">chapter</span>),
  ),
  Layout.provide(DocsLayout.DocsLayout),
  Last.provideContext(DocsKit.DocsKit, DocsCopy.layer),
);

/**
 * Root `.context(Site)` — Views use Reference defaults; copy is Layer-provided.
 * `provideMerge` keeps group kit services in the runtime Context.
 */
export const routes = pipe(
  RouterBuilder.layer(App.App),
  Layer.provideMerge(Layer.mergeAll(main, docs)),
  Last.provideContext(Site.Site, SiteCopy.layer),
);
